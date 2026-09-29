import {
	type ImportError,
	type ImportResult,
	type ImportStrategy,
	type MCPConfig,
	importMcpConfig,
	saveConfigToStorage
} from "@/lib/import-mcp-config"
import { CheckCircle2, X, XCircle } from "lucide-react"
import { useState } from "react"

type ImportConfigModalProps = {
	config: MCPConfig
	onImported: (config: MCPConfig) => void
}

const MODAL_ID = "import_config_modal"

function closeModal() {
	;(document.getElementById(MODAL_ID) as HTMLDialogElement | null)?.close()
}

const STRATEGY_OPTIONS: Array<{
	value: ImportStrategy
	label: string
	description: string
}> = [
	{
		value: "overwrite",
		label: "覆盖",
		description: "用新配置整体替换同名服务器"
	},
	{
		value: "skip",
		label: "跳过",
		description: "保留已有服务器，忽略同名条目"
	},
	{
		value: "merge",
		label: "合并 env",
		description: "保留原配置，仅将新的 env 键合并进去"
	}
]

export function ImportConfigModal({
	config,
	onImported
}: ImportConfigModalProps) {
	const [text, setText] = useState("")
	const [strategy, setStrategy] = useState<ImportStrategy>("overwrite")
	const [result, setResult] = useState<ImportResult | null>(null)
	const [storageError, setStorageError] = useState<string | null>(null)

	const resetState = () => {
		setText("")
		setStrategy("overwrite")
		setResult(null)
		setStorageError(null)
	}

	const handleClose = () => {
		closeModal()
	}

	const handleImport = () => {
		setStorageError(null)
		const importResult = importMcpConfig(text, config, strategy)
		setResult(importResult)

		if (!importResult.ok) {
			return
		}

		const saveResult = saveConfigToStorage(importResult.config)
		if (!saveResult.ok) {
			setStorageError(saveResult.message ?? "写入本地存储失败。")
			return
		}

		onImported(importResult.config)
	}

	const { added, overwritten, skipped } = result?.ok
		? result.summary
		: { added: 0, overwritten: 0, skipped: 0 }
	const strategyLabel =
		STRATEGY_OPTIONS.find((option) => option.value === strategy)?.label ??
		"覆盖"

	const orderedErrors: ImportError[] =
		result && !result.ok
			? [...result.errors].sort((a, b) =>
					a.index === b.index
						? a.field.localeCompare(b.field)
						: a.index - b.index
				)
			: []

	return (
		<dialog id={MODAL_ID} className="modal backdrop-blur-sm">
			<div className="modal-box rounded-3xl max-w-2xl">
				<div className="flex justify-between items-center mb-4 sticky top-0 py-4 -mt-4 -mx-6 px-6 z-10 bg-base-100">
					<h3 className="text-xl ml-4">批量导入 JSON 配置</h3>
					<button
						type="button"
						className="btn btn-square btn-ghost"
						onClick={handleClose}
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				<div className="grid gap-4 py-2 px-4">
					<p className="text-sm opacity-70">
						粘贴 mcp.json 内容，支持
						<code className="mx-1 px-1 bg-base-200 rounded">
							&#123; "mcpServers": &#123;...&#125; &#125;
						</code>
						、服务器映射或
						<code className="mx-1 px-1 bg-base-200 rounded">
							[&#123; "name": "..." &#125;]
						</code>
						数组。任一条目非法时整批不会落盘。
					</p>

					<textarea
						className="textarea textarea-bordered w-full h-48 font-mono text-sm"
						placeholder='&#123;&#10;  "mcpServers": &#123;&#10;    "my-server": &#123; "command": "node", "args": ["server.js"] &#125;&#10;  &#125;&#10;&#125;'
						value={text}
						onChange={(event) => setText(event.target.value)}
					/>

					<div>
						<span className="text-sm font-medium">
							同名服务器处理方式
						</span>
						<div className="flex flex-col gap-2 mt-2">
							{STRATEGY_OPTIONS.map((option) => (
								<label
									key={option.value}
									className="flex items-start gap-3 cursor-pointer px-3 py-2 rounded-2xl bg-base-200 has-[:checked]:bg-base-300"
								>
									<input
										type="radio"
										name="import-strategy"
										className="radio radio-sm radio-primary mt-1"
										checked={strategy === option.value}
										onChange={() =>
											setStrategy(option.value)
										}
									/>
									<span className="flex flex-col">
										<span className="text-sm font-medium">
											{option.label}
										</span>
										<span className="text-xs opacity-70">
											{option.description}
										</span>
									</span>
								</label>
							))}
						</div>
					</div>

					{result?.ok && (
						<div
							role="alert"
							className="alert alert-success rounded-2xl flex-col items-start"
						>
							<div className="flex items-center gap-2">
								<CheckCircle2 className="w-5 h-5" />
								<span>
									导入成功，已写入本地存储并刷新列表。
								</span>
							</div>
							<div className="flex flex-wrap gap-2 text-sm">
								<span className="badge badge-success badge-lg">
									新增 {added}
								</span>
								<span className="badge badge-primary badge-lg">
									{strategyLabel} {overwritten}
								</span>
								<span className="badge badge-ghost badge-lg">
									跳过 {skipped}
								</span>
							</div>
						</div>
					)}

					{result && !result.ok && result.parseError && (
						<div
							role="alert"
							className="alert alert-error rounded-2xl"
						>
							<XCircle className="w-5 h-5 shrink-0" />
							<span>{result.parseError}</span>
						</div>
					)}

					{result && !result.ok && orderedErrors.length > 0 && (
						<div
							role="alert"
							className="alert alert-error rounded-2xl flex-col items-start gap-2"
						>
							<div className="flex items-center gap-2">
								<XCircle className="w-5 h-5 shrink-0" />
								<span>
									发现 {orderedErrors.length}{" "}
									个问题，整批未写入。请修改后重试：
								</span>
							</div>
							<ul className="list-disc pl-6 text-sm space-y-1 w-full">
								{orderedErrors.map((error, key) => (
									<li key={key}>
										第 {error.index + 1} 条 · 字段
										<code className="px-1 bg-error/20 rounded mx-1">
											{error.field}
										</code>
										：{error.message}
									</li>
								))}
							</ul>
						</div>
					)}

					{storageError && (
						<div
							role="alert"
							className="alert alert-warning rounded-2xl"
						>
							<XCircle className="w-5 h-5 shrink-0" />
							<span>{storageError}</span>
						</div>
					)}
				</div>

				<div className="modal-action mr-4">
					<button
						type="button"
						className="btn btn-ghost"
						onClick={resetState}
					>
						清空
					</button>
					<button
						type="button"
						className="btn btn-primary"
						onClick={handleImport}
					>
						导入
					</button>
				</div>
			</div>
			<form method="dialog" className="modal-backdrop">
				<button type="button">close</button>
			</form>
		</dialog>
	)
}
