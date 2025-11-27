import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Foundry, type DeployedContract } from "@adraffy/blocksmith";
import { RESOLVE_ABI } from "@namestone/ezccip";
import { serve } from "@namestone/ezccip/serve";
import { dnsEncode, EnsResolver, getAddress, ZeroHash } from "ethers";

const A = "0x51050ec063d393217B436747617aD1C2285Aeeee";

describe("e2e", () => {
	let F: Foundry;
	let S: Awaited<ReturnType<typeof serve>>;
	let R: DeployedContract;
	beforeAll(async () => {
		F = await Foundry.launch();
		S = await serve(
			(name) => {
				if (name === "raffy.eth") {
					return {
						addr(coinType) {
							if (coinType == 0x8000_0000n) {
								return A;
							}
						},
						text(key) {
							return `key is ${key}`;
						},
					};
				}
			},
			{ protocol: "ens" }
		);
		R = await F.deploy({
			file: "OffchainResolver",
			args: [[S.signer], [S.endpoint]],
		});
	});
	afterAll(() => F?.shutdown);
	afterAll(() => S?.shutdown);

	test("toggle signer", async () => {
		expect(R.isSigner(A)).resolves.toBeFalse();
		await R.setSigner(A, true);
		expect(R.isSigner(A)).resolves.toBeTrue();
		await R.setSigner(A, false);
		expect(R.isSigner(A)).resolves.toBeFalse();
	});

	test("unknown name", async () => {
		const r = new EnsResolver(F.provider, R.target, "__dne");
		expect(r.getAddress(), "addr(60)").resolves.toStrictEqual(null);
		expect(r.getText("abc"), "text(abc)").resolves.toStrictEqual("");
	});

	test("resolve", async () => {
		const r = new EnsResolver(F.provider, R.target, "raffy.eth");
		expect(r.getAddress(), "addr(60)").resolves.toStrictEqual(A);
		expect(r.getText("abc"), "text(abc)").resolves.toStrictEqual("key is abc");
	});

	test("multicall", async () => {
		const [answers] = RESOLVE_ABI.decodeFunctionResult(
			"multicall",
			await R.resolve(
				dnsEncode("raffy.eth"),
				RESOLVE_ABI.encodeFunctionData("multicall", [
					[
						RESOLVE_ABI.encodeFunctionData("addr(bytes32)", [ZeroHash]),
						RESOLVE_ABI.encodeFunctionData("text", [ZeroHash, "abc"]),
					],
				]),
				{ enableCcipRead: true }
			)
		);
		const [addr] = RESOLVE_ABI.decodeFunctionResult(
			"addr(bytes32)",
			answers[0]
		);
		const [text] = RESOLVE_ABI.decodeFunctionResult("text", answers[1]);
		expect(getAddress(addr)).toStrictEqual(A);
		expect(text).toStrictEqual("key is abc");
	});
});
