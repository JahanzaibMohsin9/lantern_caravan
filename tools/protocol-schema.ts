import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { haggleOfferSchema, intentSchema, ledgerOpSchema, quoteSchema } from "@lantern/protocol";
import { actionStatusSchema, chronicleEntrySchema, contracts, healthSchema, historyRowSchema, loginResultSchema,
  loginSchema, requestEnvelope, responseEnvelope, snapshotSchema } from "@lantern/protocol/schemas";

const simple = { request: requestEnvelope, response: responseEnvelope, ledgerOp: ledgerOpSchema, intent: intentSchema,
  quote: quoteSchema, haggleOffer: haggleOfferSchema, snapshot: snapshotSchema, actionStatus: actionStatusSchema,
  historyRow: historyRowSchema, chronicleEntry: chronicleEntrySchema, health: healthSchema, login: loginSchema, loginResult: loginResultSchema };
const schema = (value: z.ZodType) => z.toJSONSchema(value, { reused: "ref" });
const methods = Object.fromEntries(Object.entries(contracts).map(([name, [params, result]]) => [name, { params: schema(params), result: schema(result) }]));
const examples = {
  request: { version: 1, request_id: "req-001", method: "get_quote", params: { session_id: "the-row", night_id: "night-1",
    intent: { type: "buy", stall_id: "oil_wharf", item_id: "oil", quantity: "2" } } },
  actionStatus: { state: "confirmed", receipt: { id: "dev-001", label: "Dev receipt" } },
  error: { version: 1, request_id: "req-001", ok: false, result: null, error: { code: "ORDER_FILLED", message: "The boat already has those lanterns." } },
};
await writeFile("packages/protocol/market.schema.json", JSON.stringify({
  schemas: Object.fromEntries(Object.entries(simple).map(([name, value]) => [name, schema(value)])), methods, examples,
}, null, 2) + "\n");
