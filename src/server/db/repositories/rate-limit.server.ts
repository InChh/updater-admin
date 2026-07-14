import { lte, sql } from "drizzle-orm";

import type { Database } from "../client.server";
import { rateLimitWindows } from "../schema";

export interface RateLimitInput {
	readonly endpoint: string;
	readonly limit: number;
	readonly now: Date;
	readonly subjectKey: string;
	readonly windowSeconds: number;
}

export interface RateLimitDecision {
	readonly allowed: boolean;
	readonly count: number;
	readonly limit: number;
	readonly remaining: number;
	readonly resetAt: Date;
	readonly retryAfterSeconds: number;
}

export interface RateLimitRepository {
	consume(input: RateLimitInput): Promise<RateLimitDecision>;
}

type RateLimitDatabase = Pick<Database, "delete" | "insert">;

function validateInput(input: RateLimitInput): void {
	if (
		!input.endpoint ||
		!input.subjectKey ||
		!Number.isInteger(input.limit) ||
		input.limit < 1 ||
		!Number.isInteger(input.windowSeconds) ||
		input.windowSeconds < 1 ||
		Number.isNaN(input.now.getTime())
	) {
		throw new RangeError("Invalid rate-limit input.");
	}
}

export function calculateFixedWindow(
	now: Date,
	windowSeconds: number,
): { readonly expiresAt: Date; readonly windowStartedAt: Date } {
	const windowMilliseconds = windowSeconds * 1000;
	const startedAt =
		Math.floor(now.getTime() / windowMilliseconds) * windowMilliseconds;
	return {
		expiresAt: new Date(startedAt + windowMilliseconds),
		windowStartedAt: new Date(startedAt),
	};
}

export function createRateLimitRepository(
	database: RateLimitDatabase,
): RateLimitRepository {
	return {
		async consume(input) {
			validateInput(input);
			const { expiresAt, windowStartedAt } = calculateFixedWindow(
				input.now,
				input.windowSeconds,
			);

			await database
				.delete(rateLimitWindows)
				.where(lte(rateLimitWindows.expiresAt, input.now));
			const [window] = await database
				.insert(rateLimitWindows)
				.values({
					count: 1,
					endpoint: input.endpoint,
					expiresAt,
					subjectKey: input.subjectKey,
					windowStartedAt,
				})
				.onConflictDoUpdate({
					set: {
						count: sql`${rateLimitWindows.count} + 1`,
						expiresAt,
					},
					target: [
						rateLimitWindows.endpoint,
						rateLimitWindows.subjectKey,
						rateLimitWindows.windowStartedAt,
					],
				})
				.returning({ count: rateLimitWindows.count });
			if (!window) throw new Error("Rate-limit increment returned no row.");

			const remaining = Math.max(0, input.limit - window.count);
			const retryAfterSeconds = Math.max(
				1,
				Math.ceil((expiresAt.getTime() - input.now.getTime()) / 1000),
			);
			return {
				allowed: window.count <= input.limit,
				count: window.count,
				limit: input.limit,
				remaining,
				resetAt: expiresAt,
				retryAfterSeconds,
			};
		},
	};
}
