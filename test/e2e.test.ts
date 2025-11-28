import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Foundry, type DeployedContract } from "@adraffy/blocksmith";
import { RESOLVE_ABI } from "@namestone/ezccip";
import { serve } from "@namestone/ezccip/serve";
import { dnsEncode, namehash, id as labelhash, ZeroHash } from "ethers";

// test constants
const ETH = "0x51050ec063d393217B436747617aD1C2285Aeeee";
const BTC = "0xdeadfee5";
const CH = "0x1234";

describe("e2e", () => {
	let F: Foundry;
	let S: Awaited<ReturnType<typeof serve>>;
	let OR: DeployedContract;
	let UR: DeployedContract;
	beforeAll(async () => {
		F = await Foundry.launch({ infoLog: false }); // enable to show anvil events
		// deploy OffchainResolver
		const { admin } = F.wallets;
		OR = await F.deploy({
			file: "OffchainResolver",
			args: [admin, [], []],
		});
		// setup offchain server
		S = await serve(
			(name) => {
				if (name === "raffy.eth") {
					return {
						addr(coinType) {
							if (coinType === 0x8000_0000n) {
								return ETH; // default address
							} else if (coinType === 0n) {
								return BTC;
							}
						},
						text(key) {
							return `key is ${key}`;
						},
						contenthash() {
							return CH;
						},
						// if not a standard profile
						// by default, ezccip will return UnsupportedResolverProfile()
					};
				}
				// we dont know this name
				// by default, ezccip will return UnreachableName()
			},
			{ protocol: "ens" }
		);
		// ezccip generates a random key if not specified
		// add this key as a trusted signer
		await F.confirm(OR.setSigner(S.signer, true));
		// to support recursive ccip-read, we ignore the ccip sender,
		// and instead sign relative to the contract we're supporting.
		// note: ezccip automatically interprets the first address
		// in an URL as the "origin" of the ccip request
		await F.confirm(OR.setGateways([`${S.endpoint}/${OR.target}`]));
		// deploy ENS registry
		const ENS = await F.deploy({
			import: "@ens/registry/ENSRegistry.sol",
		});
		// setup "addr.reverse" to handle ReverseClaimer.claim() on UR
		const FakeReverseRegistrar = await F.deploy(`contract X {
			function claim(address) external pure returns (bytes32) {}
		}`);
		await F.confirm(ENS.setSubnodeOwner(ZeroHash, labelhash("reverse"), admin));
		await F.confirm(
			ENS.setSubnodeOwner(
				namehash("reverse"),
				labelhash("addr"),
				FakeReverseRegistrar
			)
		);
		// deploy UniversalResolver
		const BatchGatewayProvider = await F.deploy({
			import: "@ens/ccipRead/GatewayProvider.sol",
			args: [admin, []], // no gateways are required since OffchainResolver supports ENSIP-22
		});
		UR = await F.deploy({
			import: "@ens/universalResolver/UniversalResolver.sol",
			args: [admin, ENS, BatchGatewayProvider],
		});
		// setup "raffy.eth"
		await F.confirm(ENS.setSubnodeOwner(ZeroHash, labelhash("eth"), admin));
		await F.confirm(
			ENS.setSubnodeRecord(namehash("eth"), labelhash("raffy"), admin, OR, 0)
		);
	});
	afterAll(() => F?.shutdown);
	afterAll(() => S?.shutdown);

	test("toggle signer", async () => {
		expect(OR.isSigner(ETH)).resolves.toBeFalse();
		await F.confirm(OR.setSigner(ETH, true));
		expect(OR.isSigner(ETH)).resolves.toBeTrue();
		await F.confirm(OR.setSigner(ETH, false));
		expect(OR.isSigner(ETH)).resolves.toBeFalse();
	});

	test("UnreachableName", async () => {
		const error = RESOLVE_ABI.parseError(
			await OR.resolve(
				dnsEncode("__dne"),
				RESOLVE_ABI.encodeFunctionData("addr(bytes32)", [ZeroHash]),
				{ enableCcipRead: true }
			)
		);
		expect(error?.name).toStrictEqual("UnreachableName");
	});

	test("UnsupportedResolverProfile", async () => {
		const error = RESOLVE_ABI.parseError(
			await OR.resolve(dnsEncode("raffy.eth"), "0x12345678", {
				enableCcipRead: true,
			})
		);
		expect(error?.name).toStrictEqual("UnsupportedResolverProfile");
	});

	test("direct: addr() via default", async () => {
		const fragment = "addr(bytes32)";
		const [value] = RESOLVE_ABI.decodeFunctionResult(
			fragment,
			await OR.resolve(
				dnsEncode("raffy.eth"),
				RESOLVE_ABI.encodeFunctionData(fragment, [ZeroHash]),
				{ enableCcipRead: true }
			)
		);
		expect(value).toStrictEqual(ETH);
	});

	test("direct: addr(60) via default", async () => {
		const fragment = "addr(bytes32,uint256)";
		const [value] = RESOLVE_ABI.decodeFunctionResult(
			fragment,
			await OR.resolve(
				dnsEncode("raffy.eth"),
				RESOLVE_ABI.encodeFunctionData(fragment, [ZeroHash, 60]),
				{ enableCcipRead: true }
			)
		);
		expect(value).toStrictEqual(ETH.toLowerCase()); // note: addr(coinType) is bytes which isn't checksummed
	});

	test("direct: addr(0)", async () => {
		const fragment = "addr(bytes32,uint256)";
		const [value] = RESOLVE_ABI.decodeFunctionResult(
			fragment,
			await OR.resolve(
				dnsEncode("raffy.eth"),
				RESOLVE_ABI.encodeFunctionData(fragment, [ZeroHash, 0]),
				{ enableCcipRead: true }
			)
		);
		expect(value).toStrictEqual(BTC);
	});

	test("direct: text()", async () => {
		const fragment = "text";
		const [value] = RESOLVE_ABI.decodeFunctionResult(
			fragment,
			await OR.resolve(
				dnsEncode("raffy.eth"),
				RESOLVE_ABI.encodeFunctionData(fragment, [ZeroHash, "abc"]),
				{ enableCcipRead: true }
			)
		);
		expect(value).toStrictEqual("key is abc");
	});

	test("direct: contenthash()", async () => {
		const fragment = "contenthash";
		const [value] = RESOLVE_ABI.decodeFunctionResult(
			fragment,
			await OR.resolve(
				dnsEncode("raffy.eth"),
				RESOLVE_ABI.encodeFunctionData(fragment, [ZeroHash]),
				{ enableCcipRead: true }
			)
		);
		expect(value).toStrictEqual(CH);
	});

	// note: this is only 1 ccip-read call
	test("direct: multicall()", async () => {
		const [answers] = RESOLVE_ABI.decodeFunctionResult(
			"multicall",
			await OR.resolve(
				dnsEncode("raffy.eth"),
				RESOLVE_ABI.encodeFunctionData("multicall", [
					[
						RESOLVE_ABI.encodeFunctionData("addr(bytes32)", [ZeroHash]), // addr(60)
						RESOLVE_ABI.encodeFunctionData("addr(bytes32,uint256)", [
							ZeroHash,
							0,
						]), // addr(0)
						RESOLVE_ABI.encodeFunctionData("text", [ZeroHash, "abc"]), //text("abc")
					],
				]),
				{ enableCcipRead: true }
			)
		);
		const [addr60] = RESOLVE_ABI.decodeFunctionResult(
			"addr(bytes32)",
			answers[0]
		);
		const [addr0] = RESOLVE_ABI.decodeFunctionResult(
			"addr(bytes32,uint256)",
			answers[1]
		);
		const [text] = RESOLVE_ABI.decodeFunctionResult("text", answers[2]);
		expect(addr60).toStrictEqual(ETH);
		expect(addr0).toStrictEqual(BTC);
		expect(text).toStrictEqual("key is abc");
	});

	test("UR: addr()", async () => {
		const [answer, resolver] = await UR.resolve(
			dnsEncode("raffy.eth"),
			RESOLVE_ABI.encodeFunctionData("addr(bytes32)", [ZeroHash]),
			{ enableCcipRead: true }
		);
		expect(resolver, "resolver").toStrictEqual(OR.target);
		const [value] = RESOLVE_ABI.decodeFunctionResult("addr(bytes32)", answer);
		expect(value).toStrictEqual(ETH);
	});

	test("UR: text()", async () => {
		const [answer, resolver] = await UR.resolve(
			dnsEncode("raffy.eth"),
			RESOLVE_ABI.encodeFunctionData("text", [ZeroHash, "abc"]),
			{ enableCcipRead: true }
		);
		expect(resolver, "resolver").toStrictEqual(OR.target);
		const [value] = RESOLVE_ABI.decodeFunctionResult("text", answer);
		expect(value).toStrictEqual("key is abc");
	});

	// note: this is only 1 ccip-read call
	test("UR: multicall()", async () => {
		const [answer, resolver] = await UR.resolve(
			dnsEncode("raffy.eth"),
			RESOLVE_ABI.encodeFunctionData("multicall", [
				[
					RESOLVE_ABI.encodeFunctionData("addr(bytes32)", [ZeroHash]), // addr(60)
					RESOLVE_ABI.encodeFunctionData("addr(bytes32,uint256)", [
						ZeroHash,
						0,
					]), // addr(0)
					RESOLVE_ABI.encodeFunctionData("text", [ZeroHash, "abc"]), //text("abc")
				],
			]),
			{ enableCcipRead: true }
		);
		const [answers] = RESOLVE_ABI.decodeFunctionResult("multicall", answer);
		expect(resolver, "resolver").toStrictEqual(OR.target);

		const [addr60] = RESOLVE_ABI.decodeFunctionResult(
			"addr(bytes32)",
			answers[0]
		);
		const [addr0] = RESOLVE_ABI.decodeFunctionResult(
			"addr(bytes32,uint256)",
			answers[1]
		);
		const [text] = RESOLVE_ABI.decodeFunctionResult("text", answers[2]);
		expect(addr60).toStrictEqual(ETH);
		expect(addr0).toStrictEqual(BTC);
		expect(text).toStrictEqual("key is abc");
	});
});
