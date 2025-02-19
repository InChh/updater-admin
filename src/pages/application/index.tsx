import applicationService, { type Application } from "@/api/services/applicationService.ts";
import { IconButton, Iconify } from "@/components/icon";
import { t } from "@/locales/i18n";
import { PlusOutlined } from "@ant-design/icons";
import { type ActionType, type ProColumns, ProTable } from "@ant-design/pro-components";
import { Button, Card, Popconfirm } from "antd";
import { useRef } from "react";

export default function ApplicationPage() {
	const columns: ProColumns<Application>[] = [
		{
			dataIndex: "index",
			valueType: "indexBorder",
			width: 48,
		},
		{
			title: "Id",
			dataIndex: "id",
			width: 300,
			copyable: true,
			valueType: "text",
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
					<IconButton onClick={() => {}}>
						<Iconify icon="solar:pen-bold-duotone" size={18} />
					</IconButton>
					<Popconfirm title={t("common.deleteConfirmText")} okText="Yes" cancelText="No" placement="left">
						<IconButton
							onClick={async () => {
								await applicationService.deleteApplication(record.id);
								// action.current?.reload();
							}}
						>
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
				scroll={{ x: "max-content" }}
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
					<Button key="button" icon={<PlusOutlined />} type="primary">
						{t("common.create")}
					</Button>,
				]}
			/>
		</Card>
	);
}
