export type MCPServer = {
	command?: string
	url?: string
	args: string[]
	env?: Record<string, string>
	[key: string]: unknown
}

export type MCPConfig = {
	mcpServers: Record<string, MCPServer>
}

export type ImportStrategy = "overwrite" | "skip" | "merge"

export type ImportError = {
	index: number
	field: string
	message: string
}

export type ImportSummary = {
	added: number
	overwritten: number
	skipped: number
}

export type ImportSuccess = {
	ok: true
	config: MCPConfig
	summary: ImportSummary
}

export type ImportFailure = {
	ok: false
	parseError?: string
	errors: ImportError[]
}

export type ImportResult = ImportSuccess | ImportFailure

export const STORAGE_KEY = "mcp-manager:mcp-config"

type JsonValue = unknown

/**
 * 去掉输入开头的 BOM，并在保留字符串字面量的前提下删除 `//` 行注释，
 * 让用户粘贴的带注释 mcp.json 也能被 JSON.parse 接受。
 */
export function stripJsonComments(input: string): string {
	const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
	let result = ""
	let inString = false
	let escaped = false

	for (let i = 0; i < text.length; i++) {
		const char = text[i]
		const next = text[i + 1]

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
			continue
		}

		if (char === "/" && next === "/") {
			while (i < text.length && text[i] !== "\n" && text[i] !== "\r") {
				i++
			}
			if (i < text.length) {
				result += text[i]
			}
			continue
		}

		result += char
	}

	return result
}

function describeJsonError(error: unknown, text: string): string {
	if (!(error instanceof SyntaxError)) {
		return "配置内容无法解析，请确认粘贴的是有效的 JSON。"
	}

	const message = error.message
	const match = message.match(/position\s+(\d+)/i)
	if (match) {
		const position = Number.parseInt(match[1], 10)
		if (Number.isInteger(position)) {
			const before = text.slice(0, position)
			const line = before.split("\n").length
			const column = position - before.lastIndexOf("\n")
			return `JSON 解析失败：第 ${line} 行第 ${column} 列附近存在语法错误，请检查括号、逗号与引号。`
		}
	}

	if (/Unexpected end of JSON input|Unterminated string/i.test(message)) {
		return "JSON 解析失败：内容不完整，请确认括号与引号已闭合。"
	}

	return "JSON 解析失败：内容不是合法的 JSON，请检查格式后重试。"
}

/** 解析粘贴内容，容忍 BOM 与 // 注释；失败时返回中文提示而不是抛出异常。 */
export function parseMcpConfigText(
	input: string
): { ok: true; value: JsonValue } | { ok: false; message: string } {
	if (input.trim() === "") {
		return {
			ok: false,
			message: "配置内容为空，请粘贴 mcp.json 内容后再导入。"
		}
	}

	const text = stripJsonComments(input)

	try {
		return { ok: true, value: JSON.parse(text) as JsonValue }
	} catch (error) {
		return { ok: false, message: describeJsonError(error, text) }
	}
}

type RawEntry = {
	name: string
	value: Record<string, JsonValue> | null
	index: number
}

function isPlainObject(value: JsonValue): value is Record<string, JsonValue> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * 支持三种粘贴形态：
 * 1. { "mcpServers": { ... } } 标准 mcp.json
 * 2. { "server-a": {...}, "server-b": {...} } 直接是服务器映射
 * 3. [{ "name": "...", ... }] 批量数组（name 来自条目自身字段）
 *
 * 结构性错误直接追加到 errors，条目下标与原始输入保持一致。
 */
function extractEntries(value: JsonValue, errors: ImportError[]): RawEntry[] {
	if (Array.isArray(value)) {
		return value.map((item, index) => {
			if (!isPlainObject(item)) {
				errors.push({
					index,
					field: "$",
					message: "该条配置必须是 JSON 对象。"
				})
				return { name: "", value: null, index }
			}
			return {
				name: typeof item.name === "string" ? item.name : "",
				value: item,
				index
			}
		})
	}

	if (!isPlainObject(value)) {
		errors.push({
			index: 0,
			field: "$",
			message: "配置顶层必须是 JSON 对象或数组。"
		})
		return []
	}

	if ("mcpServers" in value) {
		const mcpServers = value.mcpServers
		if (!isPlainObject(mcpServers)) {
			errors.push({
				index: 0,
				field: "mcpServers",
				message: "mcpServers 字段必须是一个对象。"
			})
			return []
		}

		return Object.keys(mcpServers).map((name, index) => ({
			name,
			value: isPlainObject(mcpServers[name])
				? (mcpServers[name] as Record<string, JsonValue>)
				: null,
			index
		}))
	}

	const keys = Object.keys(value)
	if (keys.every((key) => isPlainObject(value[key]))) {
		return keys.map((name, index) => ({
			name,
			value: value[name] as Record<string, JsonValue>,
			index
		}))
	}

	errors.push({
		index: 0,
		field: "mcpServers",
		message: "缺少 mcpServers 字段，且内容不是可识别的服务器映射。"
	})
	return []
}

function validateEntry(entry: RawEntry): ImportError[] {
	const errors: ImportError[] = []
	const config = entry.value

	if (config === null) {
		return errors
	}

	const trimmedName = entry.name.trim()

	if (trimmedName === "") {
		errors.push({
			index: entry.index,
			field: "name",
			message: "服务器名称不能为空。"
		})
	}

	if (
		(typeof config.command !== "string" || config.command.trim() === "") &&
		(typeof config.url !== "string" || config.url.trim() === "")
	) {
		errors.push({
			index: entry.index,
			field: "command",
			message: "command 与 url 不能同时为空，至少需要提供其中一个。"
		})
	} else if (
		"command" in config &&
		config.command !== undefined &&
		typeof config.command !== "string"
	) {
		errors.push({
			index: entry.index,
			field: "command",
			message: "command 必须是字符串。"
		})
	} else if (
		"url" in config &&
		config.url !== undefined &&
		typeof config.url !== "string"
	) {
		errors.push({
			index: entry.index,
			field: "url",
			message: "url 必须是字符串。"
		})
	}

	if ("args" in config && config.args !== undefined) {
		if (
			!Array.isArray(config.args) ||
			!config.args.every((arg) => typeof arg === "string")
		) {
			errors.push({
				index: entry.index,
				field: "args",
				message: "args 必须是字符串数组。"
			})
		}
	}

	if ("env" in config && config.env !== undefined) {
		if (!isPlainObject(config.env)) {
			errors.push({
				index: entry.index,
				field: "env",
				message: "env 必须是对象。"
			})
		} else {
			const badKeys = Object.entries(config.env)
				.filter(([, envValue]) => typeof envValue !== "string")
				.map(([key]) => key)
			if (badKeys.length > 0) {
				errors.push({
					index: entry.index,
					field: "env",
					message: `env 的值必须都是字符串，存在问题的键：${badKeys.join("、")}。`
				})
			}
		}
	}

	return errors
}

function toServer(entry: RawEntry): MCPServer {
	const config = entry.value ?? {}
	const server: MCPServer = { ...config }

	server.name = undefined
	server.args = Array.isArray(config.args)
		? (config.args.filter((arg) => typeof arg === "string") as string[])
		: []

	if (typeof config.command === "string" && config.command.trim() !== "") {
		server.command = config.command
	} else {
		server.command = undefined
	}

	if (typeof config.url === "string" && config.url.trim() !== "") {
		server.url = config.url
	} else {
		server.url = undefined
	}

	const env: Record<string, string> = {}
	if (isPlainObject(config.env)) {
		for (const [key, value] of Object.entries(config.env)) {
			if (typeof value === "string") {
				env[key] = value
			}
		}
	}
	server.env = Object.keys(env).length > 0 ? env : undefined

	return server
}

function cloneConfig(config: MCPConfig): MCPConfig {
	return {
		mcpServers: Object.fromEntries(
			Object.entries(config.mcpServers).map(([name, server]) => [
				name,
				{
					...server,
					args: [...server.args],
					env: server.env ? { ...server.env } : undefined
				}
			])
		)
	}
}

function mergeServer(existing: MCPServer, incoming: MCPServer): MCPServer {
	const env = {
		...(existing.env ?? {}),
		...(incoming.env ?? {})
	}

	return {
		...existing,
		...incoming,
		args:
			incoming.args.length > 0 ? [...incoming.args] : [...existing.args],
		env: Object.keys(env).length > 0 ? env : undefined
	}
}

/**
 * 解析并校验批量导入内容。校验为纯函数：不触碰本地存储与 React 状态，
 * 任一条目非法即整体拒绝（原子提交），错误带有序号（从 0 开始）与字段名。
 */
export function importMcpConfig(
	input: string,
	existing: MCPConfig = { mcpServers: {} },
	strategy: ImportStrategy = "overwrite"
): ImportResult {
	const parsed = parseMcpConfigText(input)
	if (!parsed.ok) {
		return { ok: false, parseError: parsed.message, errors: [] }
	}

	const errors: ImportError[] = []
	const rawEntries = extractEntries(parsed.value, errors)
	const seenNames = new Set<string>()

	for (const entry of rawEntries) {
		const trimmedName = entry.name.trim()
		errors.push(...validateEntry({ ...entry, name: trimmedName }))

		if (trimmedName !== "") {
			if (seenNames.has(trimmedName)) {
				errors.push({
					index: entry.index,
					field: "name",
					message: `服务器名称「${trimmedName}」在本批配置中重复。`
				})
			} else {
				seenNames.add(trimmedName)
			}
		}
	}

	if (errors.length > 0) {
		return { ok: false, errors }
	}

	const next = cloneConfig(existing)
	const summary: ImportSummary = {
		added: 0,
		overwritten: 0,
		skipped: 0
	}

	for (const entry of rawEntries) {
		const name = entry.name.trim()
		const incoming = toServer({ ...entry, name })
		const alreadyExists = Object.prototype.hasOwnProperty.call(
			next.mcpServers,
			name
		)

		if (!alreadyExists) {
			next.mcpServers[name] = incoming
			summary.added += 1
			continue
		}

		if (strategy === "skip") {
			summary.skipped += 1
			continue
		}

		if (strategy === "merge") {
			next.mcpServers[name] = mergeServer(next.mcpServers[name], incoming)
		} else {
			next.mcpServers[name] = incoming
		}
		summary.overwritten += 1
	}

	return { ok: true, config: next, summary }
}

export function loadStoredConfig(): MCPConfig {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY)
		if (!raw) {
			return { mcpServers: {} }
		}
		const parsed = JSON.parse(raw) as JsonValue
		if (!isPlainObject(parsed) || !isPlainObject(parsed.mcpServers)) {
			return { mcpServers: {} }
		}

		const mcpServers: Record<string, MCPServer> = {}
		for (const [name, server] of Object.entries(parsed.mcpServers)) {
			if (!isPlainObject(server)) {
				continue
			}
			mcpServers[name] = {
				...server,
				args: Array.isArray(server.args)
					? (server.args.filter(
							(arg) => typeof arg === "string"
						) as string[])
					: []
			}
		}

		return { mcpServers }
	} catch {
		return { mcpServers: {} }
	}
}

export function saveConfigToStorage(config: MCPConfig): {
	ok: boolean
	message?: string
} {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
		return { ok: true }
	} catch {
		return {
			ok: false,
			message: "写入浏览器本地存储失败，请检查存储空间或浏览器权限设置。"
		}
	}
}
