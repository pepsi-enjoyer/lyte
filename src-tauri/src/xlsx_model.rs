use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XlsxWorkbook {
    pub sheets: Vec<XlsxSheetSummary>,
    pub active_sheet_index: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_sheet: Option<XlsxSheet>,
    pub limits: XlsxPreviewLimits,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XlsxSheetSummary {
    pub index: usize,
    pub sheet_id: String,
    pub name: String,
    pub visible: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XlsxSheet {
    pub index: usize,
    pub name: String,
    pub rows: Vec<XlsxRow>,
    pub row_count: u32,
    pub column_count: u32,
    pub max_row: u32,
    pub max_column: u32,
    pub truncated: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub truncated_reasons: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<XlsxImage>,
}

/// A picture anchored onto a worksheet. Anchor coordinates follow the
/// SpreadsheetDrawingML model: `col`/`row` are zero-based cell indices and the
/// `*_off` fields are EMU offsets (914400 EMU = 1 inch = 96 px) from that
/// cell's top-left corner.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XlsxImage {
    /// "two" (twoCellAnchor), "one" (oneCellAnchor) or "absolute".
    pub anchor_type: String,
    pub from_col: u32,
    pub from_col_off: i64,
    pub from_row: u32,
    pub from_row_off: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_col: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_col_off: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_row: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to_row_off: Option<i64>,
    /// Explicit size in EMU for oneCellAnchor/absoluteAnchor pictures.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_cx: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext_cy: Option<i64>,
    pub data_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XlsxRow {
    pub index: u32,
    pub cells: Vec<XlsxCell>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XlsxCell {
    pub reference: String,
    pub row: u32,
    pub column: u32,
    pub value: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_value: Option<String>,
    pub value_type: XlsxCellValueType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_index: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum XlsxCellValueType {
    Blank,
    String,
    Number,
    Boolean,
    Date,
    Error,
    Formula,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct XlsxPreviewLimits {
    pub max_rows: u32,
    pub max_columns: u32,
    pub max_cells: usize,
}

impl Default for XlsxPreviewLimits {
    fn default() -> Self {
        Self {
            max_rows: 2_000,
            max_columns: 200,
            max_cells: 50_000,
        }
    }
}
