// Where an order opens in the workspace. The one place order links are built.
export function getOrderPath(orderId: string): string {
  return `/orders/${encodeURIComponent(orderId)}`;
}

export function getOrderQuotePath(orderId: string): string {
  return `${getOrderPath(orderId)}/quote`;
}
