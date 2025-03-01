﻿import applicationService from "@/api/services/applicationService.ts";
import type { Application } from "@/api/services/applicationService.ts";
import { IconButton, Iconify } from "@/components/icon";
import { t } from "@/locales/i18n";
import { PlusOutlined } from "@ant-design/icons";
import { type ActionType, type ProColumns, ProTable } from "@ant-design/pro-components";
import { Button, Card, Popconfirm } from "antd";
import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import CreateUpdateModal from "./create-update-modal";

export default function ApplicationPage() {
	const navigate = useNavigate();
	const [modalVisible, setModalVisible] = useState(false);
	const [currentRecord, setCurrentRecord] = useState<Application>();

	const columns: ProColumns<Application>[] = [
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
			title: t("common.name"),
			dataIndex: "name",
			width: 120,
			valueType: "text",
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
			width: 180,
			valueType: "option",
			render: (_, record) => (
				<div className="flex w-full justify-center text-gray-500 gap-2">
					<IconButton
						onClick={() => {
							navigate(`/version/${record.id}`);
						}}
					>
						<Iconify icon="stash:version-solid" size={18} />
					</IconButton>
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
							await applicationService.deleteApplication(record.id);
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

	const fetchApplications = async (page: number, pageSize: number, sorting?: string, searchKeyword?: string) => {
		return await applicationService.getApplicationList({
			sorting,
			filter: searchKeyword,
			skipCount: (page - 1) * pageSize,
			maxResultCount: pageSize,
		});
	};

	return (
		<Card title={t("application.title")}>
			<ProTable<Application>
				actionRef={action}
				rowKey="id"
				columns={columns}
				request={async (params, sort, _) => {
					let sorting: string | undefined;
					if (sort.creationTime) {
						sorting = `CreationTime ${sort.creationTime === "ascend" ? "asc" : "desc"}`;
					}
					const applications = await fetchApplications(
						params.current || 1,
						params.pageSize || 10,
						sorting,
						params.name,
					);
					return {
						data: applications.items,
						total: applications.totalCount,
						success: true,
					};
				}}
				toolbar={{
					title: t("application.title"),
				}}
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
				onFinish={async (values) => {
					if (currentRecord) {
						await applicationService.updateApplication(currentRecord.id, values);
						toast.success(t("common.editSuccess"));
					} else {
						await applicationService.createApplication(values);
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
