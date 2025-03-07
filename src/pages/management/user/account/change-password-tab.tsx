import { Button, Form, Input, message } from "antd";
import { useState } from "react";

import userService from "@/api/services/userService";
import { t } from "@/locales/i18n";

function ChangePasswordTab() {
	const [form] = Form.useForm();
	const [loading, setLoading] = useState(false);

	const handleSubmit = async (_values: {
		currentPassword: string;
		newPassword: string;
		confirmPassword: string;
	}) => {
		try {
			setLoading(true);
			await userService.changePassword({
				currentPassword: _values.currentPassword,
				newPassword: _values.newPassword,
			});
			message.success(t("account.passwordChangeSuccess"));
			form.resetFields();
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className="max-w-[600px]">
			<Form form={form} layout="vertical" onFinish={handleSubmit} autoComplete="off">
				<Form.Item
					name="currentPassword"
					label={t("account.currentPassword")}
					rules={[
						{
							required: true,
							message: t("account.pleaseInputCurrentPassword"),
						},
					]}
				>
					<Input.Password />
				</Form.Item>

				<Form.Item
					name="newPassword"
					label={t("account.newPassword")}
					rules={[
						{
							required: true,
							message: t("account.pleaseInputNewPassword"),
						},
						{
							min: 8,
							message: t("account.passwordMinLength"),
						},
					]}
				>
					<Input.Password />
				</Form.Item>

				<Form.Item
					name="confirmPassword"
					label={t("account.confirmPassword")}
					rules={[
						{
							required: true,
							message: t("account.pleaseConfirmPassword"),
						},
						({ getFieldValue }) => ({
							validator(_, value) {
								if (!value || getFieldValue("newPassword") === value) {
									return Promise.resolve();
								}
								return Promise.reject(new Error(t("account.passwordsDoNotMatch")));
							},
						}),
					]}
				>
					<Input.Password />
				</Form.Item>

				<Form.Item>
					<Button type="primary" htmlType="submit" loading={loading}>
						{t("common.submit")}
					</Button>
				</Form.Item>
			</Form>
		</div>
	);
}

export default ChangePasswordTab;
