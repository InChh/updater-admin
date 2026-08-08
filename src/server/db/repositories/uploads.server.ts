export interface RegisterUploadMetadataInput {
	readonly mimeType: string;
	readonly objectKey: string;
	readonly path: string;
	readonly sha256: string;
	readonly size: bigint;
}

export class UploadMetadataConflictRepositoryError extends Error {
	readonly index: number;
	readonly path: string;

	constructor(index: number, path: string) {
		super("Existing file metadata does not match the completed upload.");
		this.name = "UploadMetadataConflictRepositoryError";
		this.index = index;
		this.path = path;
	}
}

/** Total order for the live path/hash/size identity. */
export function compareUploadIdentity(
	left: Pick<RegisterUploadMetadataInput, "path" | "sha256" | "size">,
	right: Pick<RegisterUploadMetadataInput, "path" | "sha256" | "size">,
): number {
	return (
		left.path.localeCompare(right.path) ||
		left.sha256.localeCompare(right.sha256) ||
		(left.size < right.size ? -1 : left.size > right.size ? 1 : 0)
	);
}
