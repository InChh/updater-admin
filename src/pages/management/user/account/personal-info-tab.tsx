import { Iconify } from "@/components/icon";
import { t } from "@/locales/i18n";
import { useUserInfo } from "@/store/userStore";
import { Button, Card, Col, Form, Input, Row } from "antd";

export default function PersonalInfoTab() {
	const { username, email } = useUserInfo();

	const initFormValues = {
		username,
		email,
	};

	const handleClick = () => {};

	return (
		<Row gutter={[16, 16]}>
			<Col span={24} lg={8}>
				<Card>
					<div className="h-full flex flex-col items-center justify-center gap-4">
						<Iconify icon="mdi:account" size={170} />
						<div className="text-center">{t("account.personalInformation")}</div>
					</div>
				</Card>
			</Col>
			<Col span={24} lg={16}>
				<Card>
					<Form layout="vertical" initialValues={initFormValues} labelCol={{ span: 8 }} className="w-full">
						<Row gutter={16}>
							<Col span={12}>
								<Form.Item label={t("account.username")} name="username">
									<Input />
								</Form.Item>
							</Col>
							<Col span={12}>
								<Form.Item label={t("account.email")} name="email">
									<Input />
								</Form.Item>
							</Col>
						</Row>

						<div className="flex w-full justify-end">
							<Button type="primary" onClick={handleClick}>
								{t("common.saveText")}
							</Button>
						</div>
					</Form>
				</Card>
			</Col>
		</Row>
	);
}
