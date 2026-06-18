use serde::{Deserialize, Serialize};
use std::collections::HashMap;

fn is_false(v: &bool) -> bool {
    !*v
}

/// The main document model that represents a parsed DOCX file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub body: Vec<BlockElement>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub comments: Vec<Comment>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub headers: Vec<HeaderFooter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub footers: Vec<HeaderFooter>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub footnotes: Vec<Footnote>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub styles: HashMap<String, Style>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub images: HashMap<String, String>, // rId -> base64 data URI
}

/// Block-level elements that can appear in the document body
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum BlockElement {
    #[serde(rename = "paragraph")]
    Paragraph {
        runs: Vec<Run>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        style: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        alignment: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        list_level: Option<u8>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        list_format: Option<String>,
    },
    #[serde(rename = "table")]
    Table { rows: Vec<TableRow> },
    #[serde(rename = "page_break")]
    PageBreak,
}

/// A run of text with consistent formatting
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Run {
    pub text: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub underline: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub strikethrough: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f32>, // in pt
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>, // hex
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highlight: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment_ref: Option<u32>, // links to Comment.id
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footnote_ref: Option<u32>, // links to Footnote.id
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_id: Option<String>, // links to images map
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_url: Option<String>, // hyperlink URL
}

/// A row in a table
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableRow {
    pub cells: Vec<TableCell>,
}

/// A cell in a table
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableCell {
    pub content: Vec<BlockElement>,
    pub col_span: u32,
    pub row_span: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shading: Option<String>, // background color hex
}

/// A comment on the document
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comment {
    pub id: u32,
    pub author: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub date: Option<String>,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub para_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<u32>,
}

/// Header or footer content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeaderFooter {
    pub content: Vec<BlockElement>,
    pub section: u32,
}

/// A footnote
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Footnote {
    pub id: u32,
    pub content: Vec<BlockElement>,
}

/// Style definition with inheritance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Style {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub based_on: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heading_level: Option<u8>, // 1-6 for heading styles
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub num_id: Option<u32>, // list numbering id from the style's pPr/numPr
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ilvl: Option<u8>, // list level from the style's pPr/numPr
}

impl Document {
    /// Creates an empty document
    pub fn new() -> Self {
        Self {
            body: Vec::new(),
            comments: Vec::new(),
            headers: Vec::new(),
            footers: Vec::new(),
            footnotes: Vec::new(),
            styles: HashMap::new(),
            images: HashMap::new(),
        }
    }
}

impl Default for Document {
    fn default() -> Self {
        Self::new()
    }
}

impl Run {
    /// Creates a new text run with default formatting
    pub fn new(text: String) -> Self {
        Self {
            text,
            bold: false,
            italic: false,
            underline: false,
            strikethrough: false,
            font_size: None,
            font_family: None,
            color: None,
            highlight: None,
            comment_ref: None,
            footnote_ref: None,
            image_id: None,
            link_url: None,
        }
    }

    /// Creates a text run with basic formatting
    pub fn with_formatting(text: String, bold: bool, italic: bool, underline: bool) -> Self {
        Self {
            text,
            bold,
            italic,
            underline,
            strikethrough: false,
            font_size: None,
            font_family: None,
            color: None,
            highlight: None,
            comment_ref: None,
            footnote_ref: None,
            image_id: None,
            link_url: None,
        }
    }
}

impl TableCell {
    /// Creates a new table cell with default properties
    pub fn new(content: Vec<BlockElement>) -> Self {
        Self {
            content,
            col_span: 1,
            row_span: 1,
            shading: None,
        }
    }
}

impl Style {
    /// Creates a new empty style
    pub fn new() -> Self {
        Self {
            based_on: None,
            font_size: None,
            font_family: None,
            bold: None,
            italic: None,
            color: None,
            alignment: None,
            heading_level: None,
            num_id: None,
            ilvl: None,
        }
    }
}

impl Default for Style {
    fn default() -> Self {
        Self::new()
    }
}
