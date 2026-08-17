export const cloudflareTransactionViewCapability = Symbol(
  'AgentFS Cloudflare transaction view capability',
);

export type CloudflareTransactionViewCapability =
  typeof cloudflareTransactionViewCapability;

export function assertTransactionViewCapability(
  capability: CloudflareTransactionViewCapability,
): void {
  if (capability !== cloudflareTransactionViewCapability) {
    throw new TypeError('invalid AgentFS transaction view capability');
  }
}
