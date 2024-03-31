import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
	TOKEN_PROGRAM_ID,
	createAssociatedTokenAccountInstruction,
	getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
	ComputeBudgetProgram,
	Connection,
	PublicKey,
	SystemProgram,
	Keypair,
} from "@solana/web3.js";
import { readFile } from "fs/promises";

import { IDL, type Idl } from "./idl";
import { TOML } from "bun";
import type { Config } from "./types";
import { decode } from "bs58";
import ora from "ora";
import { setTimeout } from "timers/promises";
import { random } from "./utils";

export const JUP_MINT_ID = new PublicKey(
	"JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
);
export const JUP_STAKE_LOCKER = new PublicKey(
	"CVMdMd79no569tjc5Sq7kzz8isbfCcFyBS5TLGsrZ5dN",
);

class StakerJupiter {
	program: Program<Idl>;
	connection: Connection;
	keypair: Keypair;

	constructor(connection: Connection, keypair: Keypair) {
		this.connection = connection;
		this.keypair = keypair;
		this.program = new Program<Idl>(
			IDL,
			"voTpe3tHQ7AjQHMapgSue2HJFAh2cGsdokqN3XqmVSj",
			new AnchorProvider(
				this.connection,
				new Wallet(keypair),
				AnchorProvider.defaultOptions(),
			),
		);
	}

	async stake(amount: number) {
		const owner = this.program.provider.publicKey as PublicKey;

		const instructions = [
			ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 30000 }),
			ComputeBudgetProgram.setComputeUnitLimit({ units: 30000 }),
		];

		const jupATA = getAssociatedTokenAddressSync(JUP_MINT_ID, owner);

		const [escrow] = PublicKey.findProgramAddressSync(
			[Buffer.from("Escrow"), JUP_STAKE_LOCKER.toBuffer(), owner.toBuffer()],
			new PublicKey("voTpe3tHQ7AjQHMapgSue2HJFAh2cGsdokqN3XqmVSj"),
		);

		if (!(await this.connection.getAccountInfo(escrow))) {
			instructions.push(
				await this.program.methods
					.newEscrow()
					.accounts({
						escrow,
						escrowOwner: owner,
						locker: JUP_STAKE_LOCKER,
						payer: owner,
						systemProgram: SystemProgram.programId,
					})
					.instruction(),
			);
		}

		const escrowATA = getAssociatedTokenAddressSync(JUP_MINT_ID, escrow, true);

		if (!(await this.connection.getAccountInfo(escrowATA))) {
			instructions.push(
				createAssociatedTokenAccountInstruction(
					owner,
					escrowATA,
					escrow,
					JUP_MINT_ID,
				),
			);
		}

		return await this.program.methods
			.increaseLockedAmount(new BN(amount))
			.accounts({
				escrow,
				payer: owner,
				locker: JUP_STAKE_LOCKER,
				escrowTokens: escrowATA,
				sourceTokens: jupATA,
				tokenProgram: TOKEN_PROGRAM_ID,
			})
			.preInstructions(instructions)
			.transaction();
	}
}

async function main() {
	const spinner = ora("СТАРТИНГ Аккаунтс процессинг!!!!").start();

	const config = TOML.parse(
		await readFile("./config.toml", { encoding: "utf8" }),
	) as Config;

	let feePayer: Keypair | undefined = undefined;

	if (config.fee_payer) {
		feePayer = Keypair.fromSecretKey(decode(config.fee_payer));
	}

	if (!config.amount && !config.amount_range) {
		return spinner.fail(
			"Ну ты совсем? Почему ты не указал сколько тебе застейкать надо юпитера?",
		);
	}

	if (!config.rpc_url) {
		return spinner.fail("Ну почему ты не указал rpc_url?");
	}

	const connection = new Connection(config.rpc_url);

	if (!config.accounts_path) {
		return spinner.fail(
			"Ну что ж такое то?? все вроде указал, а accounts_path нет...",
		);
	}

	let accounts: Keypair[];

	try {
		accounts = (await readFile(config.accounts_path, { encoding: "utf-8" }))
			.split("\n")
			.map(decode)
			.map((kp) => Keypair.fromSecretKey(kp));
	} catch (e) {
		return spinner.fail("Ну файла то с аккаунтами нет!");
	}

	spinner.text = `Загружено ${accounts.length} аккаунтов`;

	await setTimeout(5000);

	for (const account of accounts) {
		spinner.text = `ПРОЦЕССИНГ АККАУНТА - ${account.publicKey.toString()}`;

		let amount: number;

		if (config.amount) {
			amount = config.amount;
		} else if (config.amount_range) {
			amount = random(...config.amount_range);
		} else {
			amount = 1;
		}

		const tx = await new StakerJupiter(connection, account).stake(
			amount * 10 ** 6,
		);
		tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

		if (feePayer) {
			tx.feePayer = feePayer.publicKey;

			tx.sign(feePayer, account);
		} else {
			tx.feePayer = account.publicKey;

			tx.sign(account);
		}

		spinner.text = await connection.sendRawTransaction(tx.serialize(), {
			skipPreflight: true,
		});

		setTimeout(5000);
	}
}

await main();
