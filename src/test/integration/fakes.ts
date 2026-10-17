import { FakeMailer } from "@/test/fake-mailer";
import { FakeSmsProvider } from "@/test/fake-sms";

// The fake SMS provider and mailer every integration test file shares (see
// setup.ts). A file that mocks the mailer itself uses its own instead.
export const fakeSms = new FakeSmsProvider();
export const fakeMailer = new FakeMailer();
