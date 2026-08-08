import { Buffer } from "node:buffer";
import { isWellFormedUnicode } from "../../shared/api/common";
import {
	PUBLIC_RELEASE_DOWNLOAD_REQUEST_MAX_ITEMS,
	PUBLIC_RELEASE_DOWNLOAD_URL_TTL_SECONDS,
	PUBLIC_RELEASE_FILE_PAGE_DEFAULT_SIZE,
	PUBLIC_RELEASE_FILE_PAGE_MAX_SIZE,
	type PublicReleaseDownloadFileInput,
	type PublicReleaseDownloadUrlsRequest,
	type PublicReleaseDownloadUrlsResponse,
	type PublicReleaseFileDto,
	type PublicReleaseFilePageDto,
	type PublicReleaseFilePageSearch,
	type PublicReleaseHeaderDto,
	type PublicReleaseManifestDto,
} from "../../shared/api/public-releases";
import {
	MAX_UPLOAD_PATH_CODE_POINTS,
	SHA256_PATTERN,
} from "../../shared/api/uploads";
import {
	createPublicReleasesRepository,
	type PublicReleaseDownloadFileRecord,
	type PublicReleaseHeaderRecord,
	type PublicReleaseRecord,
	type PublicReleasesRepository,
	type PublicReleasesRepositoryBundle,
	type PublicReleasesV2Repository,
	type PublicReleaseVersionNumber,
} from "../db/repositories/public-releases.server";
import {
	getOssDownloadUrlSigner,
	type OssDownloadUrlSigner,
} from "../integrations/oss/download-url.server";
import { parseVersionNumber } from "./version-number";

export const PUBLIC_RELEASE_SIGNING_CONCURRENCY = 8;
export const PUBLIC_RELEASE_CURSOR_MAX_LENGTH = Math.ceil(
	(MAX_UPLOAD_PATH_CODE_POINTS * 4 * 4) / 3,
);

export class PublicReleaseNotFoundError extends Error {
	constructor() {
		super("Public release was not found.");
		this.name = "PublicReleaseNotFoundError";
	}
}

export class PublicReleaseCursorError extends Error {
	constructor() {
		super("Public release cursor is invalid.");
		this.name = "PublicReleaseCursorError";
	}
}

/** Existing public v1 service surface. */
export interface PublicReleasesService {
	getByVersionNumber(
		programId: string,
		versionNumber: string,
	): Promise<PublicReleaseManifestDto>;
	getLatest(programId: string): Promise<PublicReleaseManifestDto>;
}

export interface PublicReleasesV2Service {
	getDownloadUrls(
		programId: string,
		versionNumber: string,
		input: PublicReleaseDownloadUrlsRequest,
	): Promise<PublicReleaseDownloadUrlsResponse>;
	getFilePage(
		programId: string,
		versionNumber: string,
		search: PublicReleaseFilePageSearch,
	): Promise<PublicReleaseFilePageDto>;
	getHeaderByVersionNumber(
		programId: string,
		versionNumber: string,
	): Promise<PublicReleaseHeaderDto>;
	getLatestHeader(programId: string): Promise<PublicReleaseHeaderDto>;
}

export type PublicReleasesServiceBundle = PublicReleasesService &
	PublicReleasesV2Service;

export interface PublicReleasesServiceDependencies {
	readonly getRepository?: () => PublicReleasesRepository;
	readonly getSigner?: () => OssDownloadUrlSigner;
	readonly getV2Repository?: () => PublicReleasesV2Repository;
	readonly now?: () => Date;
	readonly repository?: PublicReleasesRepository;
	readonly signer?: OssDownloadUrlSigner;
	readonly v2Repository?: PublicReleasesV2Repository;
}

function requireValidClock(now: () => Date): Date {
	const issuedAt = now();
	if (Number.isNaN(issuedAt.getTime())) {
		throw new Error("Public release clock returned an invalid date.");
	}
	return issuedAt;
}

async function signFiles(
	files: readonly PublicReleaseDownloadFileRecord[],
	getSigner: () => OssDownloadUrlSigner,
): Promise<readonly string[]> {
	const signer = getSigner();
	const urls = new Array<string>(files.length);
	let nextIndex = 0;
	const signWorker = async () => {
		while (nextIndex < files.length) {
			const index = nextIndex;
			nextIndex += 1;
			const file = files[index];
			if (!file) {
				throw new Error("Public release file ordering invariant failed.");
			}
			urls[index] = await signer.signGetUrl(file.objectKey);
		}
	};
	await Promise.all(
		Array.from(
			{
				length: Math.min(PUBLIC_RELEASE_SIGNING_CONCURRENCY, files.length),
			},
			() => signWorker(),
		),
	);
	return urls;
}

async function manifest(
	record: PublicReleaseRecord | null,
	getSigner: () => OssDownloadUrlSigner,
	now: () => Date,
): Promise<PublicReleaseManifestDto> {
	if (!record) throw new PublicReleaseNotFoundError();
	const issuedAt = requireValidClock(now);
	const urls = await signFiles(record.files, getSigner);
	const files: PublicReleaseFileDto[] = record.files.map((file, index) => {
		const downloadUrl = urls[index];
		if (!downloadUrl) {
			throw new Error("Public release signing result invariant failed.");
		}
		return {
			checksumAlgorithm: "sha256",
			downloadUrl,
			mimeType: file.mimeType,
			path: file.path,
			sha256: file.sha256,
			size: file.size.toString(),
		};
	});
	return {
		description: record.description,
		downloadExpiresAt: new Date(
			issuedAt.getTime() + PUBLIC_RELEASE_DOWNLOAD_URL_TTL_SECONDS * 1000,
		).toISOString(),
		files,
		programId: record.programId,
		programName: record.programName,
		publishedAt: record.publishedAt.toISOString(),
		versionNumber: record.versionNumber,
	};
}

function header(
	record: PublicReleaseHeaderRecord | null,
): PublicReleaseHeaderDto {
	if (!record) throw new PublicReleaseNotFoundError();
	return {
		description: record.description,
		fileCount: record.fileCount,
		programName: record.programName,
		publishedAt: record.publishedAt.toISOString(),
		versionNumber: record.versionNumber,
	};
}

function parsePublicVersion(versionNumber: string): PublicReleaseVersionNumber {
	const parsed = parseVersionNumber(versionNumber);
	if (!parsed) throw new PublicReleaseNotFoundError();
	return {
		versionMajor: parsed.major,
		versionMinor: parsed.minor,
		versionNumber: parsed.normalized,
		versionPatch: parsed.patch,
	};
}

function encodeCursor(path: string): string {
	return Buffer.from(path, "utf8").toString("base64url");
}

export function decodePublicReleaseCursor(cursor: string): string {
	if (
		cursor.length === 0 ||
		cursor.length > PUBLIC_RELEASE_CURSOR_MAX_LENGTH ||
		!/^[A-Za-z0-9_-]+$/.test(cursor)
	) {
		throw new PublicReleaseCursorError();
	}
	const path = Buffer.from(cursor, "base64url").toString("utf8");
	if (
		path.length === 0 ||
		!isWellFormedUnicode(path) ||
		Buffer.from(path, "utf8").toString("base64url") !== cursor
	) {
		throw new PublicReleaseCursorError();
	}
	return path;
}

function normalizePageSize(pageSize: number | undefined): number {
	const normalized = pageSize ?? PUBLIC_RELEASE_FILE_PAGE_DEFAULT_SIZE;
	if (
		!Number.isSafeInteger(normalized) ||
		normalized < 1 ||
		normalized > PUBLIC_RELEASE_FILE_PAGE_MAX_SIZE
	) {
		throw new PublicReleaseCursorError();
	}
	return normalized;
}

function fileIdentity(file: PublicReleaseDownloadFileInput): string {
	return `${file.path}\u0000${file.sha256}`;
}

function validateDownloadRequest(
	input: PublicReleaseDownloadUrlsRequest,
): readonly PublicReleaseDownloadFileInput[] {
	if (
		input.files.length === 0 ||
		input.files.length > PUBLIC_RELEASE_DOWNLOAD_REQUEST_MAX_ITEMS
	) {
		throw new PublicReleaseNotFoundError();
	}
	for (const file of input.files) {
		if (
			file.path.length === 0 ||
			[...file.path].length > MAX_UPLOAD_PATH_CODE_POINTS ||
			!isWellFormedUnicode(file.path) ||
			!SHA256_PATTERN.test(file.sha256)
		) {
			throw new PublicReleaseNotFoundError();
		}
	}
	return input.files;
}

function orderDownloadFiles(
	requested: readonly PublicReleaseDownloadFileInput[],
	found: readonly PublicReleaseDownloadFileRecord[],
): readonly PublicReleaseDownloadFileRecord[] {
	const byIdentity = new Map<string, PublicReleaseDownloadFileRecord>();
	for (const file of found) {
		const identity = fileIdentity(file);
		if (byIdentity.has(identity)) {
			throw new Error(
				"Public release download identity invariant was violated.",
			);
		}
		byIdentity.set(identity, file);
	}
	return requested.map((file) => {
		const record = byIdentity.get(fileIdentity(file));
		if (!record) throw new PublicReleaseNotFoundError();
		return record;
	});
}

export function createPublicReleasesService(
	dependencies: PublicReleasesServiceDependencies = {},
): PublicReleasesServiceBundle {
	let repository = dependencies.repository;
	let v2Repository = dependencies.v2Repository;
	let defaultRepository: PublicReleasesRepositoryBundle | undefined;
	let signer = dependencies.signer;
	const resolveDefaultRepository = () => {
		defaultRepository ??= createPublicReleasesRepository();
		return defaultRepository;
	};
	const resolveRepository = () => {
		repository ??= dependencies.getRepository?.() ?? resolveDefaultRepository();
		return repository;
	};
	const resolveV2Repository = () => {
		v2Repository ??=
			dependencies.getV2Repository?.() ?? resolveDefaultRepository();
		return v2Repository;
	};
	const resolveSigner = () => {
		signer ??= dependencies.getSigner?.() ?? getOssDownloadUrlSigner();
		return signer;
	};
	const now = dependencies.now ?? (() => new Date());

	return {
		async getByVersionNumber(programId, versionNumber) {
			const version = parsePublicVersion(versionNumber);
			const record = await resolveRepository().findActiveByVersionNumber(
				programId,
				version,
			);
			return manifest(record, resolveSigner, now);
		},
		async getDownloadUrls(programId, versionNumber, input) {
			const version = parsePublicVersion(versionNumber);
			const requested = validateDownloadRequest(input);
			const repositoryV2 = resolveV2Repository();
			const found = await repositoryV2.findDownloadFiles({
				files: requested,
				programId,
				version,
			});
			const ordered = orderDownloadFiles(requested, found);
			const issuedAt = requireValidClock(now);
			const urls = await signFiles(ordered, resolveSigner);
			return {
				downloadExpiresAt: new Date(
					issuedAt.getTime() + PUBLIC_RELEASE_DOWNLOAD_URL_TTL_SECONDS * 1000,
				).toISOString(),
				files: ordered.map((file, index) => {
					const downloadUrl = urls[index];
					if (!downloadUrl) {
						throw new Error("Public release signing result invariant failed.");
					}
					return {
						downloadUrl,
						path: file.path,
						sha256: file.sha256,
					};
				}),
			};
		},
		async getFilePage(programId, versionNumber, search) {
			const version = parsePublicVersion(versionNumber);
			const pageSize = normalizePageSize(search.pageSize);
			const afterPath =
				search.cursor === undefined
					? undefined
					: decodePublicReleaseCursor(search.cursor);
			const repositoryV2 = resolveV2Repository();
			const pageLookup = await repositoryV2.findFilePage({
				...(afterPath === undefined ? {} : { afterPath }),
				pageSize,
				programId,
				version,
			});
			if (pageLookup.status === "releaseNotFound") {
				throw new PublicReleaseNotFoundError();
			}
			if (pageLookup.status === "cursorNotFound") {
				throw new PublicReleaseCursorError();
			}
			const { page } = pageLookup;
			return {
				items: page.items.map((file) => ({
					checksumAlgorithm: file.checksumAlgorithm,
					mimeType: file.mimeType,
					path: file.path,
					sha256: file.sha256,
					size: file.size.toString(),
				})),
				nextCursor: page.nextPath === null ? null : encodeCursor(page.nextPath),
				pageSize,
				versionNumber: version.versionNumber,
			};
		},
		async getHeaderByVersionNumber(programId, versionNumber) {
			const version = parsePublicVersion(versionNumber);
			return header(
				await resolveV2Repository().findHeaderByVersionNumber(
					programId,
					version,
				),
			);
		},
		async getLatest(programId) {
			const record = await resolveRepository().findLatestActive(programId);
			return manifest(record, resolveSigner, now);
		},
		async getLatestHeader(programId) {
			return header(await resolveV2Repository().findLatestHeader(programId));
		},
	};
}
