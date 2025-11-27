import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Foundry, type DeployedContract } from "@adraffy/blocksmith";
import { serve } from "@namestone/ezccip/serve";
import {
	dnsEncode,
	EnsResolver,
	getAddress,
	Interface,
	ZeroHash,
} from "ethers";

describe("e2e", () => {
	let F: Foundry;
	let S: Awaited<ReturnType<typeof serve>>;
	let R: DeployedContract;
	beforeAll(async () => {
		F = await Foundry.launch();
		afterAll(F.shutdown);
		S = await serve(
			(name) => {
				if (name === "raffy.eth") {
					return {
						addr(coinType) {
							if (coinType == 0x8000_0000n) {
								return "0x51050ec063d393217B436747617aD1C2285Aeeee";
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
		afterAll(S.shutdown);
		R = await F.deploy({
			file: "OffchainResolver",
			args: [S.signer, [S.endpoint]],
		});
	});

	const abi = new Interface([
		`function multicall(bytes[]) view returns (bytes[])`,
		`function addr(bytes32, uint256) view returns (bytes)`,
		`function text(bytes32, string) view returns (string)`,
	]);

	test("unknown name", async () => {
		const r = new EnsResolver(F.provider, R.target, "__dne");
		expect(r.getAddress(), "addr(60)").resolves.toStrictEqual(null);
		expect(r.getText("abc"), "text(abc)").resolves.toStrictEqual("");
	});

	test("resolve", async () => {
		const r = new EnsResolver(F.provider, R.target, "raffy.eth");
		expect(r.getAddress(), "addr(60)").resolves.toStrictEqual(
			"0x51050ec063d393217B436747617aD1C2285Aeeee"
		);
		expect(r.getText("abc"), "text(abc)").resolves.toStrictEqual("key is abc");
	});

	test("multicall", async () => {
		const [answers] = abi.decodeFunctionResult(
			"multicall",
			await R.resolve(
				dnsEncode("raffy.eth"),
				abi.encodeFunctionData("multicall", [
					[
						abi.encodeFunctionData("addr", [ZeroHash, 60]),
						abi.encodeFunctionData("text", [ZeroHash, "abc"]),
					],
				]),
				{ enableCcipRead: true }
			)
		);
		const [addr] = abi.decodeFunctionResult("addr", answers[0]);
		const [text] = abi.decodeFunctionResult("text", answers[1]);
		expect(getAddress(addr)).toStrictEqual(
			"0x51050ec063d393217B436747617aD1C2285Aeeee"
		);
		expect(text).toStrictEqual("key is abc");
	});
});
