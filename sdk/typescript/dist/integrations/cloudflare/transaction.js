export const cloudflareTransactionViewCapability = Symbol('AgentFS Cloudflare transaction view capability');
export function assertTransactionViewCapability(capability) {
    if (capability !== cloudflareTransactionViewCapability) {
        throw new TypeError('invalid AgentFS transaction view capability');
    }
}
