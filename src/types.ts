export interface Config {
	accounts_path: string;
	rpc_url: string;
	amount_range?: [number, number];
	amount?: number;
	fee_payer: string;
}
