import type { BasicStatus, PermissionType } from "./enum";

export interface UserToken {
	accessToken?: string;
	refreshToken?: string;
}

export interface UserInfo {
	id: string;
	email: string;
	username: string;
	password?: string;
	avatar?: string;
	role?: string[];
}

export interface Organization {
	id: string;
	name: string;
	status: "enable" | "disable";
	desc?: string;
	order?: number;
	children?: Organization[];
}

export interface Permission {
	id: string;
	parentId: string;
	name: string;
	label: string;
	type: PermissionType;
	route: string;
	status?: BasicStatus;
	order?: number;
	icon?: string;
	component?: string;
	hide?: boolean;
	hideTab?: boolean;
	frameSrc?: URL;
	newFeature?: boolean;
	children?: Permission[];
}

export interface Role {
	id: string;
	name: string;
	label: string;
	status: BasicStatus;
	order?: number;
	desc?: string;
	permission?: Permission[];
}

interface BaseEntity {
	id: string;
	creationTime: Date;
	creatorId: string;
	lastModificationTime: Date;
	lastModifierId: string;
}

export interface Application extends BaseEntity {
	name: string;
	description?: string;
}

export interface ApplicationVersion extends BaseEntity {
	versionNumber: string;
	description?: string;
	isActive: boolean;
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
