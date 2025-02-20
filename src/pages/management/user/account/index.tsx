import { Tabs, type TabsProps } from "antd";

import { Iconify } from "@/components/icon";

import { t } from "@/locales/i18n";
import PersonalInfoTab from "./personal-info-tab";
import ChangePasswordTab from "./change-password-tab";

function UserAccount() {
	const items: TabsProps["items"] = [
		{
			key: "1",
			label: (
				<div className="flex items-center">
					<Iconify icon="solar:user-id-bold" size={24} className="mr-2" />
					<span>{t("account.personalInformation")}</span>
				</div>
			),
			children: <PersonalInfoTab />,
		},
		{
			key: "2",
			label: (
				<div className="flex items-center">
					<Iconify icon="solar:lock-bold" size={24} className="mr-2" />
					<span>{t("account.changePassword")}</span>
				</div>
			),
			children: <ChangePasswordTab />,
		},
	];

	return <Tabs defaultActiveKey="1" items={items} />;
}

export default UserAccount;
