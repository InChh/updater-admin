import type { PagedResult, PagedSortedAndFilteredRequest } from "#/api";
import type { BaseEntity } from "#/entity";
import apiClient from "../apiClient";

export enum ApplicationApi {
	Application = "/app/application",
}

export interface Application extends BaseEntity {
	name: string;
	description?: string;
}

export interface CreateUpdateApplicationRequest {
	name: string;
	description?: string;
}

const getApplicationById = (id: string) => apiClient.get<Application>({ url: `${ApplicationApi.Application}/${id}` });

const getApplicationList = (params: PagedSortedAndFilteredRequest) =>
	apiClient.get<PagedResult<Application>>({
		url: ApplicationApi.Application,
		params,
	});

const createApplication = (data: CreateUpdateApplicationRequest) =>
	apiClient.post<Application>({ url: ApplicationApi.Application, data });

const updateApplication = (id: string, data: CreateUpdateApplicationRequest) =>
	apiClient.put<Application>({ url: `${ApplicationApi.Application}/${id}`, data });

const deleteApplication = (id: string) => apiClient.delete<Application>({ url: `${ApplicationApi.Application}/${id}` });

export default {
	getApplicationById,
	getApplicationList,
	createApplication,
	updateApplication,
	deleteApplication,
};
