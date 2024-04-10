import * as dotenv from 'dotenv'
import {
	createTransferInstruction,
	getAssociatedTokenAddress,
} from '@solana/spl-token'
import {
	ComputeBudgetProgram,
	Connection,
	Keypair,
	PublicKey,
	Transaction,
} from '@solana/web3.js'
import { readFileSync, readdirSync } from 'fs'
dotenv.config({ path: '.env' })

let { RPC, TARGET_ADDRESS, TOKEN_ADDRESS, UNITS, LAMPORTS, FOLDER } =
	process.env
if (!RPC || !TARGET_ADDRESS || !TOKEN_ADDRESS)
	throw new Error("Most likely you didn't fill in some parameters in .env")
if (!FOLDER) FOLDER = './'

const connection = new Connection(RPC, { commitment: 'confirmed' })
const TOKEN = new PublicKey(TOKEN_ADDRESS)

const parseAccounts = () =>
	readdirSync(FOLDER!)
		.map((file) =>
			file.endsWith('.json') && file.length > 40
				? JSON.parse(readFileSync(`${FOLDER!}/${file}`, 'utf-8'))
				: false
		)
		.filter(Boolean)

const sendToken = async (srcWallet: Keypair) => {
	try {
		const sender = srcWallet
		const receiver = new PublicKey(TARGET_ADDRESS!)
		if (sender.publicKey == receiver) return

		let accounts = await connection.getTokenAccountsByOwner(sender.publicKey, {
			mint: TOKEN,
		})
		if (!accounts.value[0]) return

		const senderTokenAccount = await getAssociatedTokenAddress(
			TOKEN,
			sender.publicKey
		)
		const info = await connection.getTokenAccountBalance(senderTokenAccount)

		if (!senderTokenAccount || BigInt(info.value.amount) === 0n) {
			console.log(`${sender.publicKey} have ${info.value.uiAmount} tokens`)
			return false
		}

		console.log(
			`${sender.publicKey} have ${info.value.uiAmount} tokens, try send to ${receiver}`
		)

		accounts = await connection.getTokenAccountsByOwner(receiver, {
			mint: TOKEN,
		})
		if (!accounts.value[0]) return

		const destinationTokenAccount = await getAssociatedTokenAddress(
			TOKEN,
			receiver
		)

		const instructions = createTransferInstruction(
			senderTokenAccount,
			destinationTokenAccount,
			sender.publicKey,
			BigInt(info.value.amount)
		)

		const latestBlockHash = await connection.getLatestBlockhash('finalized')
		const opts = {
			feePayer: sender.publicKey,
			blockhash: latestBlockHash.blockhash,
			lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
		}

		const tx = new Transaction(opts)
		tx.add(
			ComputeBudgetProgram.setComputeUnitLimit({
				units: UNITS ? parseInt(UNITS) : 300000,
			}),
			ComputeBudgetProgram.setComputeUnitPrice({
				microLamports: LAMPORTS ? parseInt(LAMPORTS) : 20000,
			})
		)
		tx.add(instructions)
		tx.sign(sender)
		tx.recentBlockhash = latestBlockHash.blockhash

		const signedTx: Buffer = tx.serialize()

		const signature = await connection.sendRawTransaction(signedTx, {
			maxRetries: 20,
		})
		console.log(
			`Transaction Submitted: https://explorer.solana.com/tx/${signature}`
		)

		return connection
			.confirmTransaction(
				{
					signature,
					blockhash: latestBlockHash.blockhash,
					lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
				},
				'confirmed'
			)
			.then((confirmation: any) => {
				if (confirmation.value.err)
					throw new Error('🚨 Transaction not confirmed.')

				console.log(
					`Transaction Successfully Confirmed! 🎉 View on Explorer: https://explorer.solana.com/tx/${signature}`
				)
			})
	} catch (e: any) {
		console.log('error', e.message)
	}
}
const main = async () => {
	for (const secret of parseAccounts())
		await sendToken(Keypair.fromSecretKey(new Uint8Array(secret)))
}

main()
