// Field lengths shared by the forms and their server schemas. Kept apart from
// orders.ts so the customer booking page can use them without loading the
// phone-number metadata that orders.ts brings in.
export const CUSTOMER_NAME_MAX = 80;
export const ADDRESS_MAX = 200;
