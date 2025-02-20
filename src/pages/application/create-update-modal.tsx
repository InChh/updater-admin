import type { Application } from "@/api/services/applicationService";
import { t } from "@/locales/i18n";
import { Form, Input, Modal } from "antd";
import { useEffect, useState } from "react";
import { toast } from "sonner";

interface CreateUpdateModalProps {
	open: boolean;
	record?: Application;
	onCancel: () => void;
	onFinish: (values: Pick<Application, "name" | "description">) => Promise<void>;
}

export default function CreateUpdateModal({ open, record, onCancel, onFinish }: CreateUpdateModalProps) {
	const [form] = Form.useForm();
	const [loading, setLoading] = useState(false);
	const isEdit = !!record;

	useEffect(() => {
		if (open) {
			if (record) {
				form.setFieldsValue(record);
			} else {
				form.resetFields();
			}
		}
	}, [open, record, form]);

	return (
		<Modal
			title={t(isEdit ? "common.edit" : "common.create")}
			open={open}
			onCancel={onCancel}
			onOk={() => {
				form.submit();
			}}
			confirmLoading={loading}
			destroyOnClose
		>
			<Form
				form={form}
				layout="vertical"
				onFinish={async (values) => {
					setLoading(true);
					try {
						await onFinish(values);
						form.resetFields();
					} catch (error) {
						toast.error(`${t("common.operationFailed")}: ${error}`);
					} finally {
						setLoading(false);
					}
				}}
			>
				<Form.Item name="name" label={t("common.name")} rules={[{ required: true, message: t("common.required") }]}>
					<Input />
				</Form.Item>

				<Form.Item name="description" label={t("common.description")}>
					<Input.TextArea rows={4} />
				</Form.Item>
			</Form>
		</Modal>
	);
}
