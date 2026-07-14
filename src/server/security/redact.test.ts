import { describe, expect, it } from "vitest";

import {
	CIRCULAR_REFERENCE_MARKER,
	REDACTION_MARKER,
	redactSensitiveData,
} from "./redact";

describe("redactSensitiveData", () => {
	it("recursively clones arrays and objects while redacting nested key variants", () => {
		const input = {
			profile: {
				name: "Administrator",
				PASSWORD: "primary-password",
				"pass-word": "secondary-password",
				database_passwd: "database-password",
			},
			requests: [
				{
					Authori_zation: "Bearer auth-value",
					"Set.Cookie": "session=abc",
				},
				{
					clientSecret: "client-secret",
					refresh_token: "refresh-token",
					sessionId: "session-id",
					"temporary.credentials": "temporary-credentials",
				},
				{
					AWSAccessKeyId: "aws-access-key",
					"oss-sts-endpoint": "sts.example.com",
					"X-Amz-Signature": "signature",
				},
			],
			safe: {
				objectKey: "releases/app.zip",
				status: "ready",
			},
		};

		const result = redactSensitiveData(input);

		expect(result).toEqual({
			profile: {
				name: "Administrator",
				PASSWORD: REDACTION_MARKER,
				"pass-word": REDACTION_MARKER,
				database_passwd: REDACTION_MARKER,
			},
			requests: [
				{
					Authori_zation: REDACTION_MARKER,
					"Set.Cookie": REDACTION_MARKER,
				},
				{
					clientSecret: REDACTION_MARKER,
					refresh_token: REDACTION_MARKER,
					sessionId: REDACTION_MARKER,
					"temporary.credentials": REDACTION_MARKER,
				},
				{
					AWSAccessKeyId: REDACTION_MARKER,
					"oss-sts-endpoint": REDACTION_MARKER,
					"X-Amz-Signature": REDACTION_MARKER,
				},
			],
			safe: {
				objectKey: "releases/app.zip",
				status: "ready",
			},
		});
		expect(result).not.toBe(input);
		expect((result as { profile: unknown }).profile).not.toBe(input.profile);
		expect((result as { requests: unknown }).requests).not.toBe(input.requests);
		expect((result as { requests: unknown[] }).requests[0]).not.toBe(
			input.requests[0],
		);
	});

	it("redacts complete signed OSS and AWS URLs but preserves ordinary URLs", () => {
		const ordinaryUrl =
			"https://downloads.example.com/releases/app.zip?version=1.2.3&download=true";
		const input = {
			awsUrl:
				"https://bucket.s3.amazonaws.com/app.zip?X-Amz-Credential=AKIA%2Fscope&X-Amz-Signature=deadbeef",
			ordinaryUrl,
			ossUrl:
				"https://bucket.oss-cn-hangzhou.aliyuncs.com/app.zip?OSSAccessKeyId=id&Signature=value",
			relativeSignedUrl: "/app.zip?x-oss-security-token=temporary-value",
		};

		expect(redactSensitiveData(input)).toEqual({
			awsUrl: REDACTION_MARKER,
			ordinaryUrl,
			ossUrl: REDACTION_MARKER,
			relativeSignedUrl: REDACTION_MARKER,
		});
	});

	it("preserves the must-change-password policy flag while redacting password values", () => {
		expect(
			redactSensitiveData({
				currentPassword: "current-secret",
				mustChangePassword: true,
				"Must-Change_Password": false,
				newPassword: "new-secret",
				password: "another-secret",
			}),
		).toEqual({
			currentPassword: REDACTION_MARKER,
			mustChangePassword: true,
			"Must-Change_Password": false,
			newPassword: REDACTION_MARKER,
			password: REDACTION_MARKER,
		});
	});

	it("converts Date and bigint values to JSON-compatible scalars", () => {
		const createdAt = new Date("2026-07-14T12:34:56.789Z");
		const input = {
			createdAt,
			invalidDate: new Date(Number.NaN),
			nested: [{ size: 9_007_199_254_740_993n }],
			notFinite: Number.POSITIVE_INFINITY,
		};

		expect(redactSensitiveData(input)).toEqual({
			createdAt: "2026-07-14T12:34:56.789Z",
			invalidDate: null,
			nested: [{ size: "9007199254740993" }],
			notFinite: null,
		});
	});

	it("replaces object and array cycles with a stable value", () => {
		const input: {
			array: unknown[];
			child: { parent?: unknown };
			self?: unknown;
		} = { array: [], child: {} };
		input.self = input;
		input.child.parent = input;
		input.array.push(input.array);

		expect(redactSensitiveData(input)).toEqual({
			array: [CIRCULAR_REFERENCE_MARKER],
			child: { parent: CIRCULAR_REFERENCE_MARKER },
			self: CIRCULAR_REFERENCE_MARKER,
		});
	});

	it("does not mutate the original input", () => {
		const input = {
			accessToken: "original-token",
			items: [{ password: "original-password", value: "safe" }],
			url: "https://example.com/file?version=1",
		};
		const originalItem = input.items[0];

		const result = redactSensitiveData(input);

		expect(input).toEqual({
			accessToken: "original-token",
			items: [{ password: "original-password", value: "safe" }],
			url: "https://example.com/file?version=1",
		});
		expect(input.items[0]).toBe(originalItem);
		expect(result).not.toBe(input);
		expect((result as { items: unknown }).items).not.toBe(input.items);
	});
});
