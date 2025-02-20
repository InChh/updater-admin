import type { PagedAndSortedRequest, PagedResult } from "#/api";
import type { BaseEntity } from "#/entity";
import apiClient from "../apiClient";

export enum ApplicationVersionApi {
	ApplicationVersion = "/app/application-version",
	LatestApplicationVersion = "/app/application-version/latest",
}

export interface ApplicationVersion extends BaseEntity {
	versionNumber: string;
	description?: string;
	isActive: boolean;
}

export interface CreateUpdateApplicationVersion {
	applicationId: string;
	versionNumber: string;
	description?: string;
	fileMetadataIds: string[];
}

const getApplicationVersionById = (id: string) =>
	apiClient.get<ApplicationVersion>({
		url: `${ApplicationVersionApi.ApplicationVersion}/${id}`,
	});

const getApplicationVersionList = (applicationId: string, params: PagedAndSortedRequest) =>
	apiClient.get<PagedResult<ApplicationVersion>>({
		url: ApplicationVersionApi.ApplicationVersion,
		params: {
			applicationId,
			...params,
		},
	});

const createApplicationVersion = (data: CreateUpdateApplicationVersion) =>
	apiClient.post<ApplicationVersion>({
		url: ApplicationVersionApi.ApplicationVersion,
		data,
	});

const updateApplicationVersion = (id: string, data: CreateUpdateApplicationVersion) =>
	apiClient.put<ApplicationVersion>({
		url: `${ApplicationVersionApi.ApplicationVersion}/${id}`,
		data,
	});

const deleteApplicationVersion = (id: string) =>
	apiClient.delete<ApplicationVersion>({
		url: `${ApplicationVersionApi.ApplicationVersion}/${id}`,
	});

const activeApplicationVersion = (id: string) =>
	apiClient.post<ApplicationVersion>({
		url: `${ApplicationVersionApi.ApplicationVersion}/${id}/active`,
	});

const deactiveApplicationVersion = (id: string) =>
	apiClient.post<ApplicationVersion>({
		url: `${ApplicationVersionApi.ApplicationVersion}/${id}/deactive`,
	});

export default {
	getApplicationVersionById,
	getApplicationVersionList,
	createApplicationVersion,
	updateApplicationVersion,
	deleteApplicationVersion,
	activeApplicationVersion,
	deactiveApplicationVersion,
};
