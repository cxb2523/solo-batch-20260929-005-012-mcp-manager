// 批量导入 MCP 配置的解析与校验逻辑。
// 组件只负责渲染：本模块返回成功标记与逐条错误下标，不直接依赖 React / DOM 事件。

export type ImportConflictPolicy = "overwrite" | "skip" | "merge"

export type MCPServerEntry = {
	name: string
	command?: string
	url?: string
	args?: string[]
	env?: Record<string, string>
}

export type MCPConfig = {
	mcpServers: Record<string, MCPServerEntry>
}

export type ImportField = "name" | "command" | "url" | "args" | "env"

// 单条配置的校验错误，index 为该条在本次导入中的下标（从 0 开始）
export type EntryError = {
	index: number
	field: ImportField | "root"
	message: string
}

export type ParseSuccess = {
	ok: true
	entries: MCPServerEntry[]
}

export type ParseFailure = {
	ok: false
	// 解析或整体结构层面的中文错误提示
	error: string
	errors: EntryError[]
	entries: MCPServerEntry[]
}

export type ParseResult = ParseSuccess | ParseFailure

export type ImportSummary = {
	added: number
	overwritten: number
	skipped: number
	merged: number
}

export type ImportResult =
	| {
			ok: true
			config: MCPConfig
			summary: ImportSummary
	  }
	| {
			ok: false
			error: string
			config: MCPConfig
			summary: ImportSummary
	  }

export const STORAGE_KEY = "mcp-manager:mcp-config"

const FIELD_LABELS: Record<ImportField | "root", string> = {
	name: "name",
	command: "command",
	url: "url",
	args: "args",
	env: "env",
	root: "整体结构"
}

// 去除 UTF-8 BOM，以及 JSON 之外的 // 行注释（字符串内的 // 会被保留）
export function stripJsonComments(input: string): string {
	const withoutBom = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
	let result = ""
	let inString = false
	let escaped = false

	for (let i = 0; i < withoutBom.length; i++) {
		const char = withoutBom[i]

		if (inString) {
			result += char
			if (escaped) {
				escaped = false
			} else if (char === "\\") {
				escaped = true
			} else if (char === '"') {
				inString = false
			}
			continue
		}

		if (char === '"') {
			inString = true
			result += char
		} else if (char === "/" && withoutBom[i + 1] === "/") {
			// 跳到行尾，不额外补换行，避免把整行内容变成两个换行
			i += 2
			while (
				i < withoutBom.length &&
				withoutBom[i] !== "\n" &&
				withoutBom[i] !== "\r"
			) {
				i++
			}
			if (withoutBom[i] === "\r" && withoutBom[i + 1] === "\n") {
				i++
			}
			// 当前字符是 \n，由 for 的 i++ 消费
		} else {
			result += char
		}
	}

	return result
}

type RawContainer = Record<string, unknown> | unknown[]

function pickContainer(root: unknown): RawContainer | undefined {
	if (Array.isArray(root)) return root
	if (root === null || typeof root !== "object") return undefined
	const record = root as Record<string, unknown>
	if (
		record.mcpServers !== undefined &&
		(typeof record.mcpServers === "object" ||
			Array.isArray(record.mcpServers))
	) {
		return record.mcpServers as RawContainer
	}
	if (
		record.servers !== undefined &&
		(typeof record.servers === "object" || Array.isArray(record.servers))
	) {
		return record.servers as RawContainer
	}
	return undefined
}

// 从 map（key 作为 name）或数组两种形态中取出待校验的原始条目
function toRawSlots(container: RawContainer): Array<{
	index: number
	key?: string
	value: unknown
}> {
	if (Array.isArray(container)) {
		return container.map((value, index) => ({ index, value }))
	}
	return Object.entries(container).map(([key, value], index) => ({
		index,
		key,
		value
	}))
}

function validateEntry(slot: {
	index: number
	key?: string
	value: unknown
}): { entry?: MCPServerEntry; errors: EntryError[] } {
	const errors: EntryError[] = []
	const { index, value } = slot

	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return {
			errors: [
				{
					index,
					field: "root",
					message: `第 ${index + 1} 条不是有效的服务器对象，请检查整体结构（${FIELD_LABELS.root}）`
				}
			]
		}
	}

	const record = value as Record<string, unknown>
	const explicitName =
		typeof record.name === "string" ? record.name : undefined
	const name = explicitName ?? slot.key ?? ""

	if (typeof record.name !== "undefined" && typeof record.name !== "string") {
		errors.push({
			index,
			field: "name",
			message: `第 ${index + 1} 条的 name 必须是字符串`
		})
	} else if (name.trim() === "") {
		errors.push({
			index,
			field: "name",
			message: `第 ${index + 1} 条缺少 name 或 name 为空`
		})
	}

	const hasCommand =
		typeof record.command === "string" && record.command.trim() !== ""
	const hasUrl =
		typeof record.url === "string" && (record.url as string).trim() !== ""

	if (record.command !== undefined && typeof record.command !== "string") {
		errors.push({
			index,
			field: "command",
			message: `第 ${index + 1} 条的 command 必须是字符串`
		})
	}
	if (record.url !== undefined && typeof record.url !== "string") {
		errors.push({
			index,
			field: "url",
			message: `第 ${index + 1} 条的 url 必须是字符串`
		})
	}
	if (!hasCommand && !hasUrl) {
		errors.push({
			index,
			field: "command",
			message: `第 ${index + 1} 条缺少 command 与 url，至少需要提供其中之一`
		})
	}

	if (
		record.args !== undefined &&
		!(
			Array.isArray(record.args) &&
			record.args.every((arg) => typeof arg === "string")
		)
	) {
		errors.push({
			index,
			field: "args",
			message: `第 ${index + 1} 条的 args 必须是字符串数组`
		})
	}

	let env: Record<string, string> | undefined
	if (record.env !== undefined) {
		if (
			record.env === null ||
			typeof record.env !== "object" ||
			Array.isArray(record.env) ||
			Object.entries(record.env as Record<string, unknown>).some(
				([, envValue]) => typeof envValue !== "string"
			)
		) {
			errors.push({
				index,
				field: "env",
				message: `第 ${index + 1} 条的 env 必须是键值均为字符串的对象`
			})
		} else {
			env = record.env as Record<string, string>
		}
	}

	if (errors.length > 0) {
		return { errors }
	}

	const entry: MCPServerEntry = { name }
	if (hasCommand) entry.command = record.command as string
	if (hasUrl) entry.url = record.url as string
	if (Array.isArray(record.args)) entry.args = record.args as string[]
	if (env) entry.env = env

	return { entry, errors }
}

// 解析粘贴文本并逐条校验，任何失败都以中文结果返回，绝不向调用方抛栈
export function parseMcpConfig(input: string): ParseResult {
	if (typeof input !== "string" || input.trim() === "") {
		return {
			ok: false,
			error: "配置内容为空，请粘贴 mcp.json 后再导入",
			errors: [],
			entries: []
		}
	}

	let root: unknown
	try {
		root = JSON.parse(stripJsonComments(input))
	} catch {
		return {
			ok: false,
			error: "JSON 解析失败，请检查是否有多余的逗号、括号未闭合等语法问题（支持 BOM 与 // 注释）",
			errors: [],
			entries: []
		}
	}

	const container = pickContainer(root)
	if (!container) {
		return {
			ok: false,
			error: "未找到服务器列表：顶层需要是 mcpServers / servers 对象或服务器数组",
			errors: [],
			entries: []
		}
	}

	const slots = toRawSlots(container)
	if (slots.length === 0) {
		return {
			ok: false,
			error: "配置中没有任何服务器条目",
			errors: [],
			entries: []
		}
	}

	const entries: MCPServerEntry[] = []
	const errors: EntryError[] = []
	const seenNames = new Map<string, number>()

	for (const slot of slots) {
		const { entry, errors: entryErrors } = validateEntry(slot)
		errors.push(...entryErrors)
		if (entry) {
			entries.push(entry)
			const firstIndex = seenNames.get(entry.name)
			if (firstIndex === undefined) {
				seenNames.set(entry.name, slot.index)
			} else {
				errors.push({
					index: slot.index,
					field: "name",
					message: `第 ${slot.index + 1} 条 name "${entry.name}" 与第 ${
						firstIndex + 1
					} 条重复`
				})
			}
		}
	}

	if (errors.length > 0) {
		return {
			ok: false,
			error: `共有 ${errors.length} 处校验错误，已取消整批导入（未写入任何内容）`,
			errors,
			entries
		}
	}

	return { ok: true, entries }
}

export function getConflictNames(
	entries: MCPServerEntry[],
	config: MCPConfig
): string[] {
	const names = new Set<string>()
	for (const entry of entries) {
		if (config.mcpServers[entry.name]) names.add(entry.name)
	}
	return [...names]
}

function toStoredValue(entry: MCPServerEntry): MCPServerEntry {
	const value: MCPServerEntry = {}
	if (entry.command !== undefined) value.command = entry.command
	if (entry.url !== undefined) value.url = entry.url
	if (entry.args !== undefined) value.args = [...entry.args]
	if (entry.env !== undefined) value.env = { ...entry.env }
	return value
}

// 原子提交：任一条目不合法则整批不落盘
export function commitMcpImport(
	entries: MCPServerEntry[],
	existing: MCPConfig,
	policy: ImportConflictPolicy
): ImportResult {
	const summary: ImportSummary = {
		added: 0,
		overwritten: 0,
		skipped: 0,
		merged: 0
	}

	// 防御性再校验，保证写进本地存储的一定是干净数据
	const recheck = parseMcpConfig(
		JSON.stringify({ mcpServers: entries.map((entry) => ({ ...entry })) })
	)
	if (!recheck.ok) {
		return { ok: false, error: recheck.error, config: existing, summary }
	}

	const next: Record<string, MCPServerEntry> = {}
	for (const [name, value] of Object.entries(existing.mcpServers)) {
		next[name] = toStoredValue(value)
	}

	for (const entry of recheck.entries) {
		const current = next[entry.name]
		if (!current) {
			next[entry.name] = toStoredValue(entry)
			summary.added++
			continue
		}

		if (policy === "skip") {
			summary.skipped++
			continue
		}
		if (policy === "merge") {
			next[entry.name] = {
				...toStoredValue(entry),
				env: { ...(current.env ?? {}), ...(entry.env ?? {}) }
			}
			summary.merged++
			continue
		}

		next[entry.name] = toStoredValue(entry)
		summary.overwritten++
	}

	const config: MCPConfig = { mcpServers: next }

	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
	} catch {
		return {
			ok: false,
			error: "写入本地存储失败，请检查浏览器存储权限或剩余空间",
			config: existing,
			summary
		}
	}

	return { ok: true, config, summary }
}

export function loadMcpConfig(): MCPConfig {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return { mcpServers: {} }
		const parsed: unknown = JSON.parse(raw)
		if (
			parsed !== null &&
			typeof parsed === "object" &&
			!Array.isArray(parsed) &&
			typeof (parsed as MCPConfig).mcpServers === "object" &&
			(parsed as MCPConfig).mcpServers !== null
		) {
			return parsed as MCPConfig
		}
	} catch {
		// 存储损坏时静默回退到空配置
	}
	return { mcpServers: {} }
}
