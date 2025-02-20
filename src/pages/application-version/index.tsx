import applicationService from "@/api/services/applicationService";
import applicationVersionService from "@/api/services/applicationVersionService.ts";
import type { ApplicationVersion, CreateUpdateApplicationVersion } from "@/api/services/applicationVersionService.ts";
import { IconButton, Iconify } from "@/components/icon";
import { t } from "@/locales/i18n";
import { PlusOutlined } from "@ant-design/icons";
import { type ActionType, type ProColumns, ProTable } from "@ant-design/pro-components";
import { Button, Card, Popconfirm, Switch } from "antd";
import { useRef, useState } from "react";
import { useParams } from "react-router";
import { useMount } from "react-use";
import { toast } from "sonner";
import type { PagedResult } from "#/api";
import CreateUpdateModal from "./create-update-modal";

export default function ApplicationVersionPage() {
	const { applicationId } = useParams<{ applicationId: string }>();
	const [modalVisible, setModalVisible] = useState(false);
	const [currentRecord, setCurrentRecord] = useState<ApplicationVersion>();

	const columns: ProColumns<ApplicationVersion>[] = [
		{
			dataIndex: "index",
			valueType: "indexBorder",
			width: 48,
		},
		{
			title: "Id",
			dataIndex: "id",
			width: 350,
			copyable: true,
			valueType: "text",
			hideInSearch: true,
		},
		{
			title: t("application.version.versionNumber"),
			dataIndex: "versionNumber",
			width: 120,
			valueType: "text",
			hideInSearch: true,
		},
		{
			title: t("common.description"),
			dataIndex: "description",
			align: "center",
			width: 200,
			valueType: "text",
			search: false,
			hideInSearch: true,
		},
		{
			title: t("application.version.isActive"),
			dataIndex: "isActive",
			width: 120,
			valueType: "switch",
			hideInSearch: true,
			render: (_, record) => (
				<Switch
					checked={record.isActive}
					onChange={async (checked) => {
						try {
							if (checked) {
								await applicationVersionService.activeApplicationVersion(record.id);
							} else {
								await applicationVersionService.deactiveApplicationVersion(record.id);
							}
							toast.success(t("common.operationSuccess"));
							action.current?.reload();
						} catch (error) {
							toast.error(`${t("common.operationFailed")}: ${error}`);
						}
					}}
				/>
			),
		},
		{
			title: t("common.createTime"),
			dataIndex: "creationTime",
			valueType: "dateTime",
			width: 200,
			sorter: true,
			hideInSearch: true,
		},
		{
			title: t("common.action"),
			key: "operation",
			align: "center",
			width: 100,
			valueType: "option",
			render: (_, record) => (
				<div className="flex w-full justify-center text-gray-500">
					<IconButton
						onClick={() => {
							setCurrentRecord(record);
							setModalVisible(true);
						}}
					>
						<Iconify icon="solar:pen-bold-duotone" size={18} />
					</IconButton>
					<Popconfirm
						title={t("common.deleteConfirmText")}
						okText={t("common.okText")}
						cancelText={t("common.cancelText")}
						placement="left"
						onConfirm={async () => {
							await applicationVersionService.deleteApplicationVersion(record.id);
							action.current?.reload();
						}}
					>
						<IconButton>
							<Iconify icon="mingcute:delete-2-fill" size={18} className="text-error" />
						</IconButton>
					</Popconfirm>
				</div>
			),
		},
	];

	const action = useRef<ActionType>();

	const fetchApplicationVersions = async (
		page: number,
		pageSize: number,
		sorting?: string,
	): Promise<PagedResult<ApplicationVersion>> => {
		if (!applicationId) {
			return { items: [], totalCount: 0 };
		}
		return await applicationVersionService.getApplicationVersionList(applicationId, {
			sorting,
			skipCount: (page - 1) * pageSize,
			maxResultCount: pageSize,
		});
	};

	if (!applicationId) {
		return <Card>{t("application.version.noId")}</Card>;
	}

	const [title, setTitle] = useState<string>("");

	// 获取应用程序名称
	useMount(async () => {
		const application = await applicationService.getApplicationById(applicationId);
		if (application) {
			setTitle(application.name);
		}
	});

	return (
		<Card title={t("application.version.title")}>
			<ProTable<ApplicationVersion>
				actionRef={action}
				rowKey="id"
				columns={columns}
				request={async (params, sort, _) => {
					let sorting: string | undefined;
					if (sort.creationTime) {
						sorting = `CreationTime ${sort.creationTime === "ascend" ? "asc" : "desc"}`;
					}
					const versions = await fetchApplicationVersions(params.current || 1, params.pageSize || 10, sorting);
					return {
						data: versions.items,
						total: versions.totalCount,
						success: true,
					};
				}}
				toolbar={{
					title: title,
				}}
				search={false}
				toolBarRender={() => [
					<Button
						key="button"
						icon={<PlusOutlined />}
						type="primary"
						onClick={() => {
							setCurrentRecord(undefined);
							setModalVisible(true);
						}}
					>
						{t("common.create")}
					</Button>,
				]}
			/>

			<CreateUpdateModal
				open={modalVisible}
				record={currentRecord}
				onCancel={() => {
					setModalVisible(false);
					setCurrentRecord(undefined);
				}}
				onFinish={async (values: Omit<CreateUpdateApplicationVersion, "applicationId">) => {
					const data: CreateUpdateApplicationVersion = {
						...values,
						applicationId,
					};
					if (currentRecord) {
						await applicationVersionService.updateApplicationVersion(currentRecord.id, data);
						toast.success(t("common.editSuccess"));
					} else {
						await applicationVersionService.createApplicationVersion(data);
						toast.success(t("common.createSuccess"));
					}
					setModalVisible(false);
					setCurrentRecord(undefined);
					action.current?.reload();
				}}
			/>
		</Card>
	);
}
