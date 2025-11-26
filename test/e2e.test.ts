import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Foundry, type DeployedContract } from "@adraffy/blocksmith";
import { serve } from "@namestone/ezccip/serve";
import { EnsResolver } from "ethers";

describe("e2e", () => {
	let F: Foundry;
	let C: Awaited<ReturnType<typeof serve>>;
	let R: DeployedContract;
	beforeAll(async () => {
		F = await Foundry.launch();
		afterAll(F.shutdown);
		C = await serve(
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
		afterAll(C.shutdown);
		R = await F.deploy({
			file: "OffchainResolver",
			args: [C.signer, [C.endpoint]],
		});
	});

	test("exists", async () => {
		const r = new EnsResolver(F.provider, R.target, "raffy.eth");
		expect(r.getAddress(), "addr(60)").resolves.toStrictEqual(
			"0x51050ec063d393217B436747617aD1C2285Aeeee"
		);
		expect(r.getText("abc"), "text(abc)").resolves.toStrictEqual("key is abc");
	});

	test("dne", async () => {
		const r = new EnsResolver(F.provider, R.target, "dne.eth");
		expect(r.getAddress(), "addr(60)").resolves.toStrictEqual(null);
		expect(r.getText("abc"), "text(abc)").resolves.toStrictEqual("");
	});
});
