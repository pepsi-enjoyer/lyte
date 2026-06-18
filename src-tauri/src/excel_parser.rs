use crate::xlsx_model::{
    XlsxCell, XlsxCellValueType, XlsxPreviewLimits, XlsxRow, XlsxSheet, XlsxSheetSummary,
    XlsxWorkbook,
};
use calamine::{open_workbook_auto, Data, Reader, SheetVisible};
use std::fs;
use std::io::{Read, Seek};

const MAX_EXCEL_FILE_SIZE: u64 = 100 * 1024 * 1024;

pub fn parse_workbook(path: &str) -> Result<XlsxWorkbook, String> {
    validate_excel_file(path)?;

    let mut workbook =
        open_workbook_auto(path).map_err(|e| format!("Failed to open Excel workbook: {e}"))?;
    let sheets = sheet_summaries(&workbook);
    if sheets.is_empty() {
        return Err("Excel workbook does not contain sheets".to_string());
    }

    let active_sheet_index = sheets
        .iter()
        .find(|sheet| sheet.visible)
        .map(|sheet| sheet.index)
        .unwrap_or(0);
    let active_sheet = Some(read_sheet(&mut workbook, &sheets, active_sheet_index)?);

    Ok(XlsxWorkbook {
        sheets,
        active_sheet_index,
        active_sheet,
        limits: XlsxPreviewLimits::default(),
    })
}

pub fn parse_sheet(path: &str, sheet_index: usize) -> Result<XlsxSheet, String> {
    validate_excel_file(path)?;

    let mut workbook =
        open_workbook_auto(path).map_err(|e| format!("Failed to open Excel workbook: {e}"))?;
    let sheets = sheet_summaries(&workbook);
    read_sheet(&mut workbook, &sheets, sheet_index)
}

fn validate_excel_file(path: &str) -> Result<(), String> {
    let metadata = fs::metadata(path).map_err(|e| format!("Failed to open Excel file: {e}"))?;
    let file_size = metadata.len();
    if file_size == 0 {
        return Err("Invalid Excel workbook: empty file".to_string());
    }
    if file_size > MAX_EXCEL_FILE_SIZE {
        return Err("Excel workbook too large: exceeds 100 MB".to_string());
    }
    Ok(())
}

fn sheet_summaries<RS, R>(workbook: &R) -> Vec<XlsxSheetSummary>
where
    RS: Read + Seek,
    R: Reader<RS>,
{
    workbook
        .sheets_metadata()
        .iter()
        .enumerate()
        .map(|(index, sheet)| {
            let visible = sheet.visible == SheetVisible::Visible;
            XlsxSheetSummary {
                index,
                sheet_id: (index + 1).to_string(),
                name: sheet.name.clone(),
                visible,
                state: if visible {
                    None
                } else {
                    Some(
                        match sheet.visible {
                            SheetVisible::Hidden => "hidden",
                            SheetVisible::VeryHidden => "veryHidden",
                            SheetVisible::Visible => "visible",
                        }
                        .to_string(),
                    )
                },
            }
        })
        .collect()
}

fn read_sheet<RS, R>(
    workbook: &mut R,
    sheets: &[XlsxSheetSummary],
    sheet_index: usize,
) -> Result<XlsxSheet, String>
where
    RS: Read + Seek,
    R: Reader<RS>,
{
    let sheet = sheets
        .get(sheet_index)
        .ok_or_else(|| format!("Sheet index out of range: {sheet_index}"))?;
    let range = workbook
        .worksheet_range(&sheet.name)
        .map_err(|e| format!("Failed to parse Excel sheet '{}': {e:?}", sheet.name))?;
    let formulas = workbook.worksheet_formula(&sheet.name).ok();

    Ok(range_to_sheet(sheet, &range, formulas.as_ref()))
}

fn range_to_sheet(
    summary: &XlsxSheetSummary,
    range: &calamine::Range<Data>,
    formulas: Option<&calamine::Range<String>>,
) -> XlsxSheet {
    let limits = XlsxPreviewLimits::default();
    let (row_count, column_count) = range.get_size();
    let start = range.start().unwrap_or((0, 0));
    let max_row = if row_count == 0 {
        0
    } else {
        start.0.saturating_add(row_count.saturating_sub(1) as u32) + 1
    };
    let max_column = if column_count == 0 {
        0
    } else {
        start
            .1
            .saturating_add(column_count.saturating_sub(1) as u32)
            + 1
    };
    let mut truncated_reasons = Vec::new();

    if row_count as u32 > limits.max_rows {
        add_truncation_reason(
            &mut truncated_reasons,
            format!("Only the first {} rows are loaded.", limits.max_rows),
        );
    }
    if column_count as u32 > limits.max_columns {
        add_truncation_reason(
            &mut truncated_reasons,
            format!("Only the first {} columns are loaded.", limits.max_columns),
        );
    }

    let mut rows = Vec::new();
    let mut stored_cell_count = 0usize;
    for (row_offset, row) in range.rows().enumerate().take(limits.max_rows as usize) {
        let actual_row_zero_based = start.0.saturating_add(row_offset as u32);
        let row_index = actual_row_zero_based + 1;
        let mut cells = Vec::new();

        for (column_offset, value) in row.iter().enumerate().take(limits.max_columns as usize) {
            if stored_cell_count >= limits.max_cells {
                add_truncation_reason(
                    &mut truncated_reasons,
                    format!(
                        "Only the first {} non-empty cells are loaded.",
                        limits.max_cells
                    ),
                );
                break;
            }

            let actual_column_zero_based = start.1.saturating_add(column_offset as u32);
            let column_index = actual_column_zero_based + 1;
            if let Some(cell) = build_cell(
                value,
                row_index,
                column_index,
                formulas.and_then(|range| {
                    range
                        .get_value((actual_row_zero_based, actual_column_zero_based))
                        .filter(|formula| !formula.trim().is_empty())
                }),
            ) {
                cells.push(cell);
                stored_cell_count += 1;
            }
        }

        if !cells.is_empty() {
            rows.push(XlsxRow {
                index: row_index,
                cells,
                height: None,
            });
        }

        if stored_cell_count >= limits.max_cells {
            break;
        }
    }

    XlsxSheet {
        index: summary.index,
        name: summary.name.clone(),
        rows,
        row_count: row_count as u32,
        column_count: column_count as u32,
        max_row,
        max_column,
        truncated: !truncated_reasons.is_empty(),
        truncated_reasons,
        images: Vec::new(),
        default_col_width: None,
        default_row_height: None,
        columns: Vec::new(),
    }
}

fn build_cell(value: &Data, row: u32, column: u32, formula: Option<&String>) -> Option<XlsxCell> {
    let (display_value, raw_value, value_type) = match value {
        Data::Empty => {
            if formula.is_none() {
                return None;
            }
            (String::new(), None, XlsxCellValueType::Formula)
        }
        Data::Int(value) => (
            value.to_string(),
            Some(value.to_string()),
            XlsxCellValueType::Number,
        ),
        Data::Float(value) => {
            let text = trim_number(*value);
            (text.clone(), Some(text), XlsxCellValueType::Number)
        }
        Data::String(value) => (
            value.clone(),
            Some(value.clone()),
            XlsxCellValueType::String,
        ),
        Data::Bool(value) => (
            if *value { "TRUE" } else { "FALSE" }.to_string(),
            Some(value.to_string()),
            XlsxCellValueType::Boolean,
        ),
        Data::DateTime(value) => (
            value.to_string(),
            Some(value.to_string()),
            XlsxCellValueType::Date,
        ),
        Data::DateTimeIso(value) => (value.clone(), Some(value.clone()), XlsxCellValueType::Date),
        Data::DurationIso(value) => (value.clone(), Some(value.clone()), XlsxCellValueType::Date),
        Data::Error(value) => (
            value.to_string(),
            Some(value.to_string()),
            XlsxCellValueType::Error,
        ),
    };

    Some(XlsxCell {
        reference: format!("{}{}", column_name(column), row),
        row,
        column,
        value: display_value,
        raw_value,
        value_type,
        formula: formula.cloned(),
        style_index: None,
        number_format: None,
    })
}

fn add_truncation_reason(reasons: &mut Vec<String>, reason: String) {
    if !reasons.iter().any(|existing| existing == &reason) {
        reasons.push(reason);
    }
}

fn trim_number(value: f64) -> String {
    if !value.is_finite() {
        return value.to_string();
    }
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}

fn column_name(mut index: u32) -> String {
    if index == 0 {
        return String::new();
    }

    let mut chars = Vec::new();
    while index > 0 {
        index -= 1;
        chars.push((b'A' + (index % 26) as u8) as char);
        index /= 26;
    }
    chars.iter().rev().collect()
}
