import type { ApplicationVersion, CreateUpdateApplicationVersion } from "@/api/services/applicationVersionService";
import fileService, { type FileMetadata } from "@/api/services/fileService";
import useOssClient from "@/hooks/web/oss-client";
import { t } from "@/locales/i18n";
import { calculateSHA256 } from "@/utils/file";
import { FolderOutlined, UploadOutlined } from "@ant-design/icons";
import { Button, Form, Input, Modal, Progress, Upload, type UploadFile } from "antd";
import type { UploadFileStatus } from "antd/lib/upload/interface";
import { useEffect } from "react";
import { useImmer } from "use-immer";

interface CreateUpdateModalProps {
	open: boolean;
	record?: ApplicationVersion;
	onCancel: () => void;
	onFinish: (values: Omit<CreateUpdateApplicationVersion, "applicationId">) => Promise<void>;
}

export default function CreateUpdateModal({ open, record, onCancel, onFinish }: CreateUpdateModalProps) {
	const [form] = Form.useForm<CreateUpdateApplicationVersion>();

	const [fileList, updateFileList] = useImmer<UploadFile[]>([]);
	const [overallProgress, updateOverallProgress] = useImmer<number>(0);
	const [isUploading, updateIsUploading] = useImmer<boolean>(false);

	// 计算总体进度
	useEffect(() => {
		if (fileList.length === 0) {
			updateOverallProgress(0);
			return;
		}
		const progress = fileList.reduce((acc: number, file: UploadFile) => acc + (file.percent || 0), 0) / fileList.length;
		updateOverallProgress(Math.round(progress));
	}, [fileList, updateOverallProgress]);

	useEffect(() => {
		if (open) {
			if (record) {
				form.setFieldsValue(record);
				// 获取文件列表
				fileService.getFileMetadatasByVersionId(record.id).then((fileMetadatas) => {
					const files = fileMetadatas.map((fileMetadata) => ({
						uid: fileMetadata.id,
						name: fileMetadata.path,
						status: "done" as UploadFileStatus,
						percent: 100,
						url: fileMetadata.url,
					}));
					updateFileList(() => files);
					form.setFieldValue(
						"fileMetadataIds",
						fileMetadatas.map((fileMetadata) => fileMetadata.id),
					);
				});
			} else {
				form.resetFields();
				updateFileList(() => []);
			}
		}
	}, [open, record, form, updateFileList]);

	const handleFinish = async (values: CreateUpdateApplicationVersion) => {
		try {
			await onFinish(values);
			form.resetFields();
		} catch (error) {
			console.error("Create/Update version error:", error);
		}
	};

	const handleUpload = async () => {
		updateIsUploading(() => true);
		const client = await useOssClient();
		const fileMetadataIds: string[] = [];

		for (const currentFile of fileList) {
			// 如果文件已经上传完成，跳过
			if (currentFile.status === "done") {
				continue;
			}
			// 更新上传状态为开始上传
			updateFileList((draft) => {
				for (const file of draft) {
					if (file.uid === currentFile.uid) {
						file.status = "uploading";
						file.percent = 0;
					}
				}
			});

			// hash 文件，检测文件是否已经存在
			// biome-ignore lint/style/noNonNullAssertion: <explanation>
			const hash = await calculateSHA256(currentFile.originFileObj!);
			// biome-ignore lint/style/noNonNullAssertion: <explanation>
			const path = currentFile.originFileObj!.webkitRelativePath;
			// 去除根文件夹
			const paths = path.split(/[/\\]/);
			if (paths.length > 1) {
				paths.shift();
			}
			const relativePath = paths.join("/");

			// 更新哈希计算进度
			updateFileList((draft) => {
				for (const file of draft) {
					if (file.uid === currentFile.uid) {
						file.percent = 30;
					}
				}
			});

			let fileMetadata: FileMetadata;

			try {
				fileMetadata = await fileService.getFileMetadataByHash(hash, currentFile.originFileObj?.size, relativePath);
				fileMetadataIds.push(fileMetadata.id);
				updateFileList((draft) => {
					for (const file of draft) {
						if (file.uid === currentFile.uid) {
							file.status = "done";
							file.percent = 100;
							file.url = fileMetadata.url;
						}
					}
				});
			} catch {
				// 更新检查文件存在进度
				updateFileList((draft) => {
					for (const file of draft) {
						if (file.uid === currentFile.uid) {
							file.percent = 60;
						}
					}
				});

				// 文件不存在，上传文件
				try {
					// biome-ignore lint/style/noNonNullAssertion: <explanation>
					const result = await client.put(`${hash}/${currentFile.name}`, currentFile.originFileObj!);

					// 更新上传完成状态
					updateFileList((draft) => {
						for (const file of draft) {
							if (file.uid === currentFile.uid) {
								file.status = "done";
								file.percent = 100;
								file.url = result.url;
							}
						}
					});

					fileMetadata = await fileService.createFileMetadata({
						path: relativePath,
						hash,
						// biome-ignore lint/style/noNonNullAssertion: <explanation>
						size: currentFile.originFileObj!.size,
						url: result.url,
					});
					fileMetadataIds.push(fileMetadata.id);
				} catch (error) {
					updateFileList((draft) => {
						for (const file of draft) {
							if (file.uid === currentFile.uid) {
								file.status = "error";
								file.error = error;
							}
						}
					});
				}
			}
		}
		updateIsUploading(() => false);
		form.setFieldsValue({ fileMetadataIds });
	};

	return (
		<Modal
			title={record ? t("common.edit") : t("common.create")}
			open={open}
			onCancel={() => {
				form.resetFields();
				onCancel();
			}}
			onOk={() => {
				form.submit();
			}}
			okButtonProps={{
				disabled: overallProgress !== 100,
			}}
		>
			<Form form={form} layout="vertical" initialValues={record} onFinish={handleFinish}>
				<Form.Item
					name="versionNumber"
					label={t("application.version.versionNumber")}
					rules={[{ required: true, message: t("common.required") }]}
				>
					<Input />
				</Form.Item>

				<Form.Item name="description" label={t("common.description")}>
					<Input.TextArea rows={4} />
				</Form.Item>

				<Form.Item
					name="fileMetadataIds"
					isListField={true}
					label={t("application.version.files")}
					rules={[{ required: true, message: t("common.required") }]}
					validateStatus={overallProgress !== 100 ? "error" : "success"}
					help={fileList.length === 0 ? t("common.required") : undefined}
				>
					<div className="flex flex-col gap=2 justify-center content-start" style={{ maxHeight: 300 }}>
						<Upload
							directory
							// onChange={handleChange}
							beforeUpload={(file, _) => {
								updateFileList((draft) => {
									const path = file.webkitRelativePath;
									// 去除根文件夹
									const paths = path.split(/[/\\]/);
									if (paths.length > 1) {
										paths.shift();
									}
									const relativePath = paths.join("/");
									if (
										file.name !== "manifest" &&
										file.name !== "workdir" &&
										!relativePath.includes("lib/acad.dat") &&
										!file.webkitRelativePath.match(/.*logs[/\\].*UpdaterLog.*/)?.length &&
										draft.every((f) => f.name !== relativePath)
									) {
										draft.push({
											uid: file.uid,
											name: relativePath,
											status: "none" as UploadFileStatus,
											percent: 0,
											originFileObj: file,
										});
									}
								});
								return false;
							}}
							fileList={fileList}
							showUploadList={false}
						>
							<div className="flex flex-col gap-2">
								<Button icon={<FolderOutlined />}>{t("common.selectFolder")}</Button>
								{fileList.length > 0 && (
									<span>已选择文件夹：{fileList[0].originFileObj?.webkitRelativePath.split(/[/\\]/).at(0)}</span>
								)}
								{fileList.length > 0 && <Progress percent={overallProgress} />}
							</div>
						</Upload>
						<Button
							icon={<UploadOutlined />}
							type="primary"
							onClick={handleUpload}
							loading={isUploading}
							disabled={fileList.length === 0}
						>
							{t("common.upload")}
						</Button>
					</div>
				</Form.Item>
			</Form>
		</Modal>
	);
}
