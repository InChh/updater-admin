import { FolderOpen } from "lucide-solid";
import { createSignal, Show } from "solid-js";

import {
	MAX_UPLOAD_FILES,
	MAX_UPLOAD_SIZE_BYTES,
} from "../../shared/api/uploads";
import {
	normalizeUploadPaths,
	UploadPathValidationError,
} from "../../shared/uploads/path";
import type { UploadFileSelection } from "./upload-store";

export type FolderSelectionErrorCode =
	| "INVALID_PATH"
	| "TOO_MANY_FILES"
	| "FILE_TOO_LARGE";

export class FolderSelectionError extends Error {
	readonly code: FolderSelectionErrorCode;
	readonly path?: string;

	constructor(code: FolderSelectionErrorCode, path?: string, cause?: unknown) {
		super(`Unable to select upload folder: ${code}`, { cause });
		this.name = "FolderSelectionError";
		this.code = code;
		this.path = path;
	}
}

export interface FolderPickerLabels {
	readonly choose: string;
	readonly description: string;
	readonly errors: Readonly<Record<FolderSelectionErrorCode, string>>;
	readonly selected: (count: number) => string;
}

export interface FolderPickerProps {
	readonly accept?: string;
	readonly disabled?: boolean;
	readonly id?: string;
	readonly labels?: Partial<FolderPickerLabels>;
	readonly onError?: (error: FolderSelectionError) => void;
	readonly onFiles: (files: readonly UploadFileSelection[]) => void;
}

const DEFAULT_LABELS: FolderPickerLabels = {
	choose: "选择程序文件夹",
	description: "保留文件夹内的相对路径，文件将从浏览器直接上传到对象存储。",
	errors: {
		FILE_TOO_LARGE: "文件超过约 39.1 GiB 的浏览器上传上限。",
		INVALID_PATH: "文件夹中包含不支持的相对路径。",
		TOO_MANY_FILES: `一次最多选择 ${MAX_UPLOAD_FILES} 个文件。`,
	},
	selected: (count) => `已选择 ${count} 个文件`,
};

function rawRelativePath(file: File): string {
	return file.webkitRelativePath || file.name;
}

export function createFolderSelections(
	files: readonly File[],
): readonly UploadFileSelection[] {
	if (files.length > MAX_UPLOAD_FILES) {
		throw new FolderSelectionError("TOO_MANY_FILES");
	}

	for (const file of files) {
		if (BigInt(file.size) > MAX_UPLOAD_SIZE_BYTES) {
			throw new FolderSelectionError("FILE_TOO_LARGE", rawRelativePath(file));
		}
	}

	try {
		const paths = normalizeUploadPaths(files.map(rawRelativePath));
		return files
			.map((file, index) => ({
				file,
				path: paths[index] ?? rawRelativePath(file),
			}))
			.sort((left, right) =>
				left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
			);
	} catch (error) {
		if (error instanceof UploadPathValidationError) {
			throw new FolderSelectionError("INVALID_PATH", error.path, error);
		}
		throw error;
	}
}

export function FolderPicker(props: FolderPickerProps) {
	const inputId = () => props.id ?? "release-folder";
	const [selectedCount, setSelectedCount] = createSignal(0);
	const [error, setError] = createSignal<FolderSelectionError | null>(null);
	const labels = (): FolderPickerLabels => ({
		...DEFAULT_LABELS,
		...props.labels,
		errors: {
			...DEFAULT_LABELS.errors,
			...props.labels?.errors,
		},
	});
	const descriptionId = () => `${inputId()}-description`;
	const errorId = () => `${inputId()}-error`;

	return (
		<div class="grid gap-2">
			<input
				accept={props.accept}
				aria-describedby={error() ? errorId() : descriptionId()}
				aria-label={labels().choose}
				class="peer sr-only"
				disabled={props.disabled}
				id={inputId()}
				multiple
				onChange={(event) => {
					const input = event.currentTarget;
					const files = Array.from(input.files ?? []);
					input.value = "";
					if (files.length === 0) return;
					let selections: readonly UploadFileSelection[];
					try {
						selections = createFolderSelections(files);
					} catch (selectionError) {
						const nextError =
							selectionError instanceof FolderSelectionError
								? selectionError
								: new FolderSelectionError(
										"INVALID_PATH",
										undefined,
										selectionError,
									);
						setError(nextError);
						setSelectedCount(0);
						props.onError?.(nextError);
						return;
					}
					setError(null);
					setSelectedCount(selections.length);
					props.onFiles(selections);
				}}
				ref={(element) => {
					// The non-standard attributes are the interoperable directory picker
					// contract in Chromium, Safari, and Firefox.
					element.setAttribute("webkitdirectory", "");
					element.setAttribute("directory", "");
				}}
				type="file"
			/>
			<label
				class="inline-flex min-h-20 cursor-pointer items-center justify-center gap-3 rounded-lg border border-dashed border-border-strong bg-surface px-4 py-4 text-sm font-medium text-ink transition-colors hover:border-primary/50 hover:bg-mist peer-focus-visible:ring-2 peer-focus-visible:ring-primary-deep peer-focus-visible:ring-offset-2 peer-disabled:pointer-events-none peer-disabled:opacity-50"
				for={inputId()}
			>
				<span class="grid h-9 w-9 place-items-center rounded-md bg-primary-soft text-primary-deep">
					<FolderOpen aria-hidden="true" class="h-5 w-5" />
				</span>
				<span class="grid gap-0.5">
					<span>{labels().choose}</span>
					<span class="text-xs font-normal text-muted">
						{selectedCount() > 0
							? labels().selected(selectedCount())
							: labels().description}
					</span>
				</span>
			</label>
			<p class="m-0 text-xs text-muted" id={descriptionId()}>
				{labels().description}
			</p>
			<Show when={error()}>
				{(currentError) => (
					<p class="m-0 text-xs text-danger" id={errorId()} role="alert">
						{labels().errors[currentError().code]}
					</p>
				)}
			</Show>
		</div>
	);
}
