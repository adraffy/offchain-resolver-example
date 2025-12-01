import {isHexString, Interface } from "ethers";
import { createServer } from "node:http";

const abi = new Interface([
	"function query((address sender, string[] urls, bytes data)[]) external view returns (bool[] memory failures, bytes[] memory responses)",
	"error HttpError(uint16 status, string message)",
	"error Error(string message)",
]);

export async function serveBatchGateway() {
	return new Promise<{
		shutdown: () => Promise<void>;
		localBatchGatewayUrl: string;
	}>((ful) => {
		const http = createServer(async (req, res) => {
			let data: any;
			switch (req.method) {
				case "GET": {
					data = new URL(req.url!).searchParams.get("data");
					break;
				}
				case "POST": {
					const body: Buffer[] = [];
					for await (const x of req) body.push(x);
					try {
						({ data } = JSON.parse(Buffer.concat(body).toString()));
					} catch {}
					break;
				}
				default:
					return res.writeHead(405).end("expect GET or POST");
			}
			if (!isHexString(data)) return res.writeHead(400).end("expect Hex");
			const desc = abi.parseTransaction({ data });
			if (!desc || desc.name !== "query") {
				return res.writeHead(400).end("expected query()");
			}
			const requests = desc.args[0] as [string, string[], string][];
			const failures: boolean[] = [];
			const responses: string[] = [];
			await Promise.all(
				requests.map(async ([sender, urls, request], i) => {
					let firstError = "";
					for (const url of urls) {
						const get = url.includes("{data}");
						const res = await fetch(
							url.replace("{sender}", sender).replace("{data}", request),
							{
								method: get ? "GET" : "POST",
								headers: { "content-type": "application/json" },
								body: get
									? undefined
									: JSON.stringify({ data: request, sender }),
							}
						);
						let error = "unknown error";
						try {
							const { data, message } = (await res.json()) as any;
							if (res.ok && isHexString(data)) {
								responses[i] = data;
								failures[i] = false;
								return;
							} else if (typeof message === "string") {
								error = message;
							}
						} catch (err) {
							error = String(err);
						}
						if (!firstError) {
							firstError = res.ok
								? abi.encodeErrorResult("Error", [error])
								: abi.encodeErrorResult("HttpError", [res.status, error]);
						}
					}
					responses[i] =
						firstError || abi.encodeErrorResult("Error", ["no gateways"]);
					failures[i] = true;
				})
			);
			console.log(new Date(), `LocalBatchGateway(${requests.length}) ${failures.map(x => x ? '❌️' : '✅️').join('')}`);
			res.setHeader("content-type", "application/json");
			res.end(
				JSON.stringify({
					data: abi.encodeFunctionResult("query", [failures, responses]),
				})
			);
		});
		let killer: Promise<void> | undefined;
		function shutdown() {
			if (!killer) {
				if (!http.listening) return Promise.resolve();
				killer = new Promise((ful) =>
					http.close(() => {
						killer = undefined;
						ful();
					})
				);
			}
			return killer;
		}
		http.listen(() => {
			const { port } = http.address() as { port: number };
			ful({
				shutdown,
				localBatchGatewayUrl: `http://localhost:${port}/`,
			});
		});
	});
}
