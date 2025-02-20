import apiClient from "@/api/apiClient.ts";
import type { PagedResult, PagedSortedAndFilteredRequest } from "#/api.ts";
import type { BaseEntity } from "#/entity.ts";

export enum FileServiceApi {
	File = "/app/file",
}

export interface FileMetadata extends BaseEntity {
	path: string;
	hash: string;
	size: number;
	url: string;
}

export interface FileDownloadUrl {
	hash: string;
	url: string;
}

export interface CreateFileMetadataRequest {
	path: string;
	hash: string;
	size: number;
	url: string;
}

const getFileMetadataList = (params: PagedSortedAndFilteredRequest) =>
	apiClient.get<PagedResult<FileMetadata>>({
		url: FileServiceApi.File,
		params,
	});

const getFileMetadataByHash = (hash: string, size?: number, path?: string) =>
	apiClient.get<FileMetadata>({
		url: `${FileServiceApi.File}/by-hash`,
		params: { hash, size, path },
	});

const getFileMetadatasByVersionId = (versionId: string) =>
	apiClient.get<FileMetadata[]>({
		url: `${FileServiceApi.File}/by-version-id/${versionId}`,
	});

const createFileMetadata = (data: CreateFileMetadataRequest) =>
	apiClient.post<FileMetadata>({
		url: FileServiceApi.File,
		data,
	});

const getFileDownloadUrl = (hash: string, size?: number) =>
	apiClient.get<FileDownloadUrl>({
		url: `${FileServiceApi.File}/file-url`,
		params: { hash, size },
	});

export default {
	getFileMetadataList,
	getFileMetadataByHash,
	getFileMetadatasByVersionId,
	createFileMetadata,
	getFileDownloadUrl,
};
