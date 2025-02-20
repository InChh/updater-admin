import { Divider, type MenuProps } from "antd";
import Dropdown, { type DropdownProps } from "antd/es/dropdown/dropdown";
import React from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";

import { IconButton, Iconify } from "@/components/icon";
import { useUserActions, useUserInfo } from "@/store/userStore";
import { useTheme } from "@/theme/hooks";
import { useAuth } from "react-oidc-context";
import { toast } from "sonner";

/**
 * Account Dropdown
 */
export default function AccountDropdown() {
	const { username, email, avatar } = useUserInfo();
	const { clearUserInfoAndToken } = useUserActions();
	const { t } = useTranslation();
	const auth = useAuth();
	const logout = () => {
		try {
			clearUserInfoAndToken();
			auth.signoutRedirect();
		} catch (error) {
			toast.error(`${t("common.operationFailed")}: ${error}`);
			console.log(error);
		}
	};
	const {
		themeVars: { colors, borderRadius, shadows },
	} = useTheme();

	const contentStyle: React.CSSProperties = {
		backgroundColor: colors.background.default,
		borderRadius: borderRadius.lg,
		boxShadow: shadows.dropdown,
	};

	const menuStyle: React.CSSProperties = {
		boxShadow: "none",
	};

	const dropdownRender: DropdownProps["dropdownRender"] = (menu) => (
		<div style={contentStyle}>
			<div className="flex flex-col items-start p-4">
				<div>{username}</div>
				<div className="text-gray">{email}</div>
			</div>
			<Divider style={{ margin: 0 }} />
			{React.cloneElement(menu as React.ReactElement, { style: menuStyle })}
		</div>
	);

	const items: MenuProps["items"] = [
		{
			label: <NavLink to="/management/user/profile">{t("sys.menu.user.profile")}</NavLink>,
			key: "0",
		},
		{
			label: <NavLink to="/management/user/account">{t("sys.menu.user.account")}</NavLink>,
			key: "1",
		},
		{ type: "divider" },
		{
			label: (
				<button className="font-bold text-warning" type="button">
					{t("sys.login.logout")}
				</button>
			),
			key: "2",
			onClick: logout,
		},
	];

	return (
		<Dropdown menu={{ items }} trigger={["click"]} dropdownRender={dropdownRender}>
			<IconButton className="h-10 w-10 transform-none px-0 hover:scale-105">
				{avatar ? (
					<img className="h-8 w-8 rounded-full" src={avatar} alt="" />
				) : (
					<Iconify icon="mdi:account" size={24} />
				)}
			</IconButton>
		</Dropdown>
	);
}
