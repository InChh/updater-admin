import { describe, expect, it } from "vitest";

import {
	CIRCULAR_REFERENCE_MARKER,
	REDACTION_MARKER,
	redactSensitiveData,
	scrubObservabilityEvent,
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
		const ordinaryUrlWithFragment =
			"https://git.example.com/team/repo?tab=readme#setup";
		const input = {
			apiKeyUrl:
				"https://downloads.example.com/app.zip?api_key=synthetic-secret",
			awsUrl:
				"https://bucket.s3.amazonaws.com/app.zip?X-Amz-Credential=AKIA%2Fscope&X-Amz-Signature=deadbeef",
			fragmentTokenUrl:
				"https://app.example.com/callback#access_token=synthetic-secret&token_type=bearer",
			githubTokenInBenignParameter:
				"https://git.example.com/team/repo?ref=ghp_0123456789abcdefghijklmnopqrstuv",
			jwtInBenignFragment:
				"https://git.example.com/team/repo#state=eyJheader12345.eyJpayload12345.signature12345",
			nestedFragmentTokenUrl:
				"https://app.example.com/#/callback?client_secret=synthetic-secret",
			ordinaryUrl,
			ordinaryUrlWithFragment,
			ossUrl:
				"https://bucket.oss-cn-hangzhou.aliyuncs.com/app.zip?OSSAccessKeyId=id&Signature=value",
			relativeSignedUrl: "/app.zip?x-oss-security-token=temporary-value",
			tokenUrl: "https://downloads.example.com/app.zip?token=synthetic-secret",
		};

		expect(redactSensitiveData(input)).toEqual({
			apiKeyUrl: REDACTION_MARKER,
			awsUrl: REDACTION_MARKER,
			fragmentTokenUrl: REDACTION_MARKER,
			githubTokenInBenignParameter: REDACTION_MARKER,
			jwtInBenignFragment: REDACTION_MARKER,
			nestedFragmentTokenUrl: REDACTION_MARKER,
			ordinaryUrl,
			ordinaryUrlWithFragment,
			ossUrl: REDACTION_MARKER,
			relativeSignedUrl: REDACTION_MARKER,
			tokenUrl: REDACTION_MARKER,
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

	it("keeps diagnostic structure while dropping free-form Sentry request and PII fields", () => {
		const input = {
			breadcrumbs: [{ message: "typed email admin@example.com" }],
			exception: {
				values: [
					{
						stacktrace: {
							frames: [
								{
									filename: "src/server/api/app.server.ts",
									vars: { DATABASE_URL: "postgresql://user:pass@host/db" },
								},
							],
						},
						type: "Error",
						value: "failed with password=hunter2",
					},
				],
			},
			extra: { formValue: "admin@example.com" },
			message: "token=secret-value",
			request: {
				cookies: "better-auth.session_token=secret",
				data: { email: "admin@example.com", password: "secret" },
				headers: { authorization: "Bearer secret" },
				query_string: "download=admin@example.com",
				url: "https://admin.example.com/programs/3a1c5d9c-db70-4b51-9034-5678a3a6bde3/versions/42?email=admin@example.com#row",
			},
			tags: { request_id: "req_safe", route: "/programs" },
			transaction:
				"GET /programs/3a1c5d9c-db70-4b51-9034-5678a3a6bde3/versions/42?tab=files",
			user: { email: "admin@example.com", id: "user_safe", name: "Admin" },
		};

		expect(scrubObservabilityEvent(input)).toEqual({
			exception: {
				values: [
					{
						stacktrace: {
							frames: [{ filename: "src/server/api/app.server.ts" }],
						},
						type: "Error",
						value: REDACTION_MARKER,
					},
				],
			},
			message: REDACTION_MARKER,
			request: {
				url: "https://admin.example.com/programs/:id/versions/:number",
			},
			tags: { request_id: "req_safe", route: "/programs" },
			transaction: "GET /programs/:id/versions/:number",
			user: { id: "user_safe" },
		});
		expect(input.request.headers.authorization).toBe("Bearer secret");
	});
});
