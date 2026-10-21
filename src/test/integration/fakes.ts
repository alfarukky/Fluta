import { FakeMailer } from "@/test/fake-mailer";
import { FakePaystackClient } from "@/test/fake-paystack";
import { FakeSmsProvider } from "@/test/fake-sms";

// The fake SMS provider, mailer, and Paystack client every integration test file shares (see
// setup.ts). A file that mocks the mailer itself uses its own instead.
export const fakeSms = new FakeSmsProvider();
export const fakeMailer = new FakeMailer();
export const fakePaystack = new FakePaystackClient();
