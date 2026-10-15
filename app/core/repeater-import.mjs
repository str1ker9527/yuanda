/** Shared, strict CSV/Tab parser for editor preview and Agent transactions. */
export const REPEATER_IMPORT_LIMIT = 4 * 1024 * 1024;
const fail = message => { const error = new Error(message); error.code = 'VALIDATION_ERROR'; throw error; };

export function parseDelimitedRows(text, delimiter) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > REPEATER_IMPORT_LIMIT) fail('导入文字必须在 4 MiB 以内');
  if (!['comma', 'tab'].includes(delimiter)) fail('分隔符只支持 comma 或 tab');
  const separator = delimiter === 'comma' ? ',' : '\t', source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const rows = []; let row = [], value = '', quoted = false, endedQuote = false, started = false, line = 1;
  const cell = () => { if (value.length > 50000) fail(`第 ${line} 行的单元格超过 50000 字符`); row.push(value); if (row.length > 100) fail(`第 ${line} 行超过 100 列`); value = ''; endedQuote = false; };
  const record = () => { cell(); if (started || row.length > 1 || row[0] !== '') rows.push(row); if (rows.length > 10001) fail('导入最多 10000 条数据和一行表头'); row = []; started = false; };
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"') { if (source[index + 1] === '"') { value += '"'; index++; } else { quoted = false; endedQuote = true; } }
      else { value += char; if (char === '\n') line++; }
    } else if (char === separator) { started = true; cell(); }
    else if (char === '\n') { record(); line++; }
    else if (endedQuote) fail(`第 ${line} 行：结束引号后只能是分隔符或换行`);
    else if (char === '"') { if (value.length) fail(`第 ${line} 行：文字中的引号必须使用双引号转义`); quoted = true; started = true; }
    else { value += char; started = true; }
  }
  if (quoted) fail(`第 ${line} 行：引号未闭合`);
  if (started || value || row.length) record();
  if (!rows.length) fail('没有可导入的数据');
  const width = rows[0].length;
  for (let index = 0; index < rows.length; index++) if (rows[index].length !== width) fail(`第 ${index + 1} 条记录有 ${rows[index].length} 列，预期 ${width} 列`);
  return rows;
}

export function prepareRepeaterImport({ text, delimiter, hasHeader, columnMap }, columns) {
  if (typeof hasHeader !== 'boolean') fail('是否包含表头必须是布尔值');
  const records = parseDelimitedRows(text, delimiter), headers = hasHeader ? records[0] : records[0].map((_, index) => `第 ${index + 1} 列`), data = hasHeader ? records.slice(1) : records;
  if (!data.length || data.length > 10000) fail('需要 1–10000 条数据记录');
  if (!Array.isArray(columns) || !columns.length || !Array.isArray(columnMap) || columnMap.length !== columns.length) fail('每个目标列必须有一个导入映射');
  const seen = new Set();
  for (const mapping of columnMap) {
    if (!mapping || typeof mapping !== 'object' || Object.keys(mapping).some(key => !['sourceIndex', 'targetKey'].includes(key)) || !Number.isInteger(mapping.sourceIndex) || mapping.sourceIndex < 0 || mapping.sourceIndex >= headers.length || !columns.some(column => column.key === mapping.targetKey) || seen.has(mapping.targetKey)) fail('列映射无效或目标列重复');
    seen.add(mapping.targetKey);
  }
  const rows = data.map((record, index) => {
    const values = Object.create(null);
    for (const column of columns) {
      const mapping = columnMap.find(item => item.targetKey === column.key), raw = record[mapping.sourceIndex], trimmed = raw.trim();
      if (column.type === 'string') values[column.key] = raw;
      else if (column.type === 'number') {
        if (!trimmed || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed) || !Number.isFinite(Number(trimmed))) fail(`第 ${index + 1} 条数据，列“${column.label || column.key}”：不是有效数字`);
        values[column.key] = Number(trimmed);
      } else if (column.type === 'boolean') {
        if (!['true', 'false', '1', '0', '是', '否'].includes(trimmed)) fail(`第 ${index + 1} 条数据，列“${column.label || column.key}”：请输入 true/false、1/0 或 是/否`);
        values[column.key] = ['true', '1', '是'].includes(trimmed);
      } else fail('目标列类型无效');
    }
    return { values: { ...values } };
  });
  return { headers, rows };
}
