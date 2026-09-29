import {
	type ImportConflictPolicy,
	type ImportSummary,
	type MCPServerEntry,
	commitMcpImport,
	getConflictNames,
	parseMcpConfig
} from "@/lib/import-mcp-config"
import { AlertTriangle, CheckCircle2, FileUp, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

type Stage = "input" | "confirm" | "result"

const POLICY_OPTIONS: Array<{
	value: ImportConflictPolicy
	label: string
	hint: string
}> = [
	{
		value: "overwrite",
		label: "覆盖",
		hint: "用导入的配置替换同名服务器"
	},
	{
		value: "skip",
		label: "跳过",
		hint: "保留现有同名服务器，不导入该条"
	},
	{
		value: "merge",
		label: "合并 env",
		hint: "其余字段以导入为准，env 按 key 合并（导入值优先）"
	}
]

type ImportMcpConfigModalProps = {
	existing: Record<string, MCPServerEntry>
	onImported: (config: {
		mcpServers: Record<string, MCPServerEntry>
	}) => void
}

export function ImportMcpConfigModal({
	existing,
	onImported
}: ImportMcpConfigModalProps) {
	const [text, setText] = useState("")
	const [stage, setStage] = useState<Stage>("input")
	const [parseError, setParseError] = useState("")
	const [entryErrors, setEntryErrors] = useState<
		Array<{ index: number; field: string; message: string }>
	>([])
	const [entries, setEntries] = useState<MCPServerEntry[]>([])
	const [policy, setPolicy] = useState<ImportConflictPolicy>("overwrite")
	const [result, setResult] = useState<
		| { ok: true; summary: ImportSummary }
		| { ok: false; error: string }
		| null
	>(null)

	const dialogRef = useRef<HTMLDialogElement>(null)

	// 关闭弹层（含 ESC / 点遮罩）后重置，避免再次打开看到上一次结果
	useEffect(() => {
		const dialog = dialogRef.current
		if (!dialog) return
		const handleClose = () => resetState()
		dialog.addEventListener("close", handleClose)
		return () => dialog.removeEventListener("close", handleClose)
	}, [])

	const conflictNames = getConflictNames(entries, {
		mcpServers: existing
	})

	const resetState = () => {
		setText("")
		setStage("input")
		setParseError("")
		setEntryErrors([])
		setEntries([])
		setPolicy("overwrite")
		setResult(null)
	}

	const closeModal = () => {
		;(
			document.getElementById(
				"import_mcp_config_modal"
			) as HTMLDialogElement
		)?.close()
	}

	const handleParse = () => {
		const parsed = parseMcpConfig(text)
		if (parsed.ok) {
			setEntries(parsed.entries)
			setParseError("")
			setEntryErrors([])
			setStage("confirm")
		} else {
			setParseError(parsed.error)
			setEntryErrors(parsed.errors)
			setEntries(parsed.entries)
			setStage("input")
		}
	}

	const handleCommit = () => {
		const importResult = commitMcpImport(
			entries,
			{ mcpServers: existing },
			policy
		)
		if (importResult.ok) {
			onImported(importResult.config)
			setResult({ ok: true, summary: importResult.summary })
			setStage("result")
		} else {
			setResult({ ok: false, error: importResult.error })
		}
	}

	const summaryItems: Array<{ label: string; value: number }> = result?.ok
		? [
				{ label: "新增", value: result.summary.added },
				{ label: "覆盖", value: result.summary.overwritten },
				{ label: "跳过", value: result.summary.skipped },
				{ label: "合并 env", value: result.summary.merged }
			]
		: []

	return (
		<dialog
			ref={dialogRef}
			id="import_mcp_config_modal"
			className="modal backdrop-blur-sm"
		>
			<div className="modal-box rounded-3xl max-w-2xl">
				<div className="flex justify-between items-center mb-4 sticky top-0 py-4 -mt-4 -mx-6 px-6 z-10 bg-base-100">
					<h3 className="text-xl ml-4">批量导入 JSON 配置</h3>
					<button
						type="button"
						className="btn btn-square btn-ghost"
						onClick={closeModal}
					>
						<X className="w-4 h-4" />
					</button>
				</div>

				<div className="grid gap-4 py-2 px-4">
					{stage === "input" && (
						<>
							<p className="text-sm opacity-80">
								粘贴 mcp.json 内容，支持顶层 mcpServers /
								servers 对象或服务器数组，允许 BOM 与 {"//"}{" "}
								行注释。
							</p>
							<textarea
								className="textarea textarea-bordered w-full h-56 font-mono text-sm"
								placeholder='{"mcpServers": {"my-server": {"command": "node", "args": ["server.js"]}}}'
								value={text}
								onChange={(event) =>
									setText(event.target.value)
								}
							/>
							{parseError && (
								<div className="alert alert-error text-sm py-2">
									<AlertTriangle className="w-4 h-4 shrink-0" />
									<span>{parseError}</span>
								</div>
							)}
							{entryErrors.length > 0 && (
								<ul className="bg-red-50 rounded-2xl p-4 space-y-1 text-sm max-h-44 overflow-y-auto">
									{entryErrors.map((itemError, itemIndex) => (
										<li
											key={`${itemError.index}-${itemError.field}-${itemIndex}`}
											className="flex gap-2 text-error"
										>
											<span className="badge badge-error badge-sm mt-0.5">
												第 {itemError.index + 1} 条
											</span>
											<span>
												<strong>
													[{itemError.field}]
												</strong>{" "}
												{itemError.message.replace(
													/^第 \d+ 条/,
													""
												)}
											</span>
										</li>
									))}
								</ul>
							)}
							<div className="flex justify-end gap-2">
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
									onClick={handleParse}
								>
									<FileUp className="w-4 h-4" />
									校验并预览
								</button>
							</div>
						</>
					)}

					{stage === "confirm" && (
						<>
							<div className="alert alert-success text-sm py-2">
								<CheckCircle2 className="w-4 h-4 shrink-0" />
								<span>
									{entries.length}
									条配置全部通过校验。确认后将原子提交：任一条失败都不会写入本地存储。
								</span>
							</div>

							{conflictNames.length > 0 && (
								<div className="bg-base-200 rounded-2xl p-4 space-y-3">
									<p className="text-sm">
										以下服务器已存在：
										<span className="font-medium">
											{conflictNames.join("、")}
										</span>
										，请选择同名处理方式：
									</p>
									<div className="join join-vertical w-full">
										{POLICY_OPTIONS.map((option) => (
											<label
												key={option.value}
												className="join-item flex items-start gap-3 p-3 cursor-pointer hover:bg-base-300 rounded-xl"
											>
												<input
													type="radio"
													name="conflict-policy"
													className="radio radio-sm radio-primary mt-1"
													checked={
														policy === option.value
													}
													onChange={() =>
														setPolicy(option.value)
													}
												/>
												<span>
													<span className="font-medium">
														{option.label}
													</span>
													<span className="block text-xs opacity-70">
														{option.hint}
													</span>
												</span>
											</label>
										))}
									</div>
								</div>
							)}

							<ul className="bg-base-200 rounded-2xl p-4 space-y-1 text-sm max-h-48 overflow-y-auto">
								{entries.map((entry, entryIndex) => (
									<li
										key={`${entry.name}-${entryIndex}`}
										className="flex items-center gap-2"
									>
										<span className="badge badge-ghost badge-sm">
											{entryIndex + 1}
										</span>
										<span className="font-medium">
											{entry.name}
										</span>
										<span className="opacity-60">
											{entry.command ?? entry.url}
										</span>
										{existing[entry.name] !== undefined && (
											<span className="badge badge-warning badge-sm">
												同名
											</span>
										)}
									</li>
								))}
							</ul>

							<div className="flex justify-end gap-2">
								<button
									type="button"
									className="btn btn-ghost"
									onClick={() => setStage("input")}
								>
									返回修改
								</button>
								<button
									type="button"
									className="btn btn-primary"
									onClick={handleCommit}
								>
									确认导入
								</button>
							</div>
						</>
					)}

					{stage === "result" && result?.ok && (
						<>
							<div className="alert alert-success text-sm py-2">
								<CheckCircle2 className="w-4 h-4 shrink-0" />
								<span>
									导入成功，已写入本地存储并刷新服务器列表。
								</span>
							</div>
							<div className="grid grid-cols-4 gap-2">
								{summaryItems.map((item) => (
									<div
										key={item.label}
										className="bg-base-200 rounded-2xl p-4 text-center"
									>
										<div className="text-2xl font-medium">
											{item.value}
										</div>
										<div className="text-xs opacity-70 mt-1">
											{item.label}
										</div>
									</div>
								))}
							</div>
							<div className="flex justify-end">
								<button
									type="button"
									className="btn btn-primary"
									onClick={() => {
										resetState()
										closeModal()
									}}
								>
									完成
								</button>
							</div>
						</>
					)}

					{stage === "result" && result && !result.ok && (
						<>
							<div className="alert alert-error text-sm py-2">
								<AlertTriangle className="w-4 h-4 shrink-0" />
								<span>{result.error}</span>
							</div>
							<div className="flex justify-end gap-2">
								<button
									type="button"
									className="btn btn-ghost"
									onClick={() => setStage("confirm")}
								>
									返回
								</button>
							</div>
						</>
					)}
				</div>
			</div>
			<form method="dialog" className="modal-backdrop">
				<button type="button">close</button>
			</form>
		</dialog>
	)
}
