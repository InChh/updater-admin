import type { RcFile } from "antd/lib/upload";

export async function calculateSHA256(file: File): Promise<string> {
	const buffer = await file.arrayBuffer();
	const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
	return hashHex;
}

export function getAllFiles(files: FileList | null): File[] {
	if (!files) return [];
	return Array.from(files);
}

// 获取文件相对于根文件夹的路径
export function getRelativePath(file: File, rootPath: string): string {
	const fullPath = file.webkitRelativePath || file.name;
	if (!rootPath || !fullPath.startsWith(rootPath)) {
		return fullPath;
	}
	return fullPath.slice(rootPath.length + 1);
}

// 构建目录树结构用于展示
export interface FileNode {
	key: string;
	title: string;
	children?: FileNode[];
	isLeaf?: boolean;
	path: string;
	file?: RcFile;
}

export function buildFileTree(files: RcFile[]): FileNode[] {
	const root: FileNode[] = [];
	const map = new Map<string, FileNode>();

	for (const file of files) {
		const paths = file.webkitRelativePath.split("/");
		let currentPath = "";

		for (const [index, name] of paths.entries()) {
			const isFile = index === paths.length - 1;
			currentPath = currentPath ? `${currentPath}/${name}` : name;

			if (!map.has(currentPath)) {
				const node: FileNode = {
					key: currentPath,
					title: name,
					path: currentPath,
					isLeaf: isFile,
					children: isFile ? undefined : [],
				};

				if (isFile) {
					node.file = file;
				}

				map.set(currentPath, node);

				if (index === 0) {
					root.push(node);
				} else {
					const parentPath = paths.slice(0, index).join("/");
					const parent = map.get(parentPath);
					parent?.children?.push(node);
				}
			}
		}
	}

	return root;
}
