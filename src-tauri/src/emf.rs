//! Rasterizes Enhanced Metafile (EMF) images to PNG.
//!
//! EMF is a Windows vector format that browsers cannot display, so DOCX files
//! that embed EMF pictures (commonly screenshots pasted from Office apps) would
//! otherwise show nothing. On Windows we replay the metafile into an off-screen
//! device context and encode the result as PNG. On other platforms there is no
//! GDI, so conversion is unavailable.

/// Converts EMF bytes to PNG bytes, or `None` if conversion is unavailable or
/// fails.
#[cfg(windows)]
pub fn emf_to_png(bytes: &[u8]) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::{COLORREF, RECT};
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, CreateSolidBrush, DeleteDC, DeleteEnhMetaFile,
        DeleteObject, FillRect, GdiFlush, GetEnhMetaFileHeader, PlayEnhMetaFile, SelectObject,
        SetEnhMetaFileBits, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, ENHMETAHEADER,
        HGDIOBJ,
    };

    // Cap the raster so a metafile with an enormous bounding box cannot allocate
    // an unreasonable bitmap.
    const MAX_DIMENSION: i32 = 4000;

    unsafe {
        let hemf = SetEnhMetaFileBits(bytes);
        if hemf.is_invalid() {
            return None;
        }

        let result = (|| {
            let mut header = ENHMETAHEADER::default();
            let header_size = std::mem::size_of::<ENHMETAHEADER>() as u32;
            if GetEnhMetaFileHeader(hemf, header_size, Some(&mut header)) == 0 {
                return None;
            }

            let (mut width, mut height) = emf_pixel_size(&header);
            width = width.clamp(1, MAX_DIMENSION);
            height = height.clamp(1, MAX_DIMENSION);

            let hdc = CreateCompatibleDC(None);
            if hdc.is_invalid() {
                return None;
            }

            let bmi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height, // negative => top-down rows
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };

            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let hbitmap =
                CreateDIBSection(hdc, &bmi, DIB_RGB_COLORS, &mut bits, None, 0).ok();
            let Some(hbitmap) = hbitmap else {
                let _ = DeleteDC(hdc);
                return None;
            };
            if bits.is_null() {
                let _ = DeleteObject(HGDIOBJ(hbitmap.0));
                let _ = DeleteDC(hdc);
                return None;
            }

            let previous = SelectObject(hdc, HGDIOBJ(hbitmap.0));

            // Metafiles assume an opaque (usually white) page; fill first so any
            // unpainted area is white rather than transparent black.
            let rect = RECT {
                left: 0,
                top: 0,
                right: width,
                bottom: height,
            };
            let brush = CreateSolidBrush(COLORREF(0x00FF_FFFF));
            FillRect(hdc, &rect, brush);
            let _ = DeleteObject(HGDIOBJ(brush.0));

            let _ = PlayEnhMetaFile(hdc, hemf, &rect);
            let _ = GdiFlush();

            let pixel_count = (width as usize) * (height as usize);
            let raw = std::slice::from_raw_parts(bits as *const u8, pixel_count * 4);
            let mut rgb = Vec::with_capacity(pixel_count * 3);
            for pixel in raw.chunks_exact(4) {
                // DIB is BGRA; emit RGB.
                rgb.push(pixel[2]);
                rgb.push(pixel[1]);
                rgb.push(pixel[0]);
            }

            SelectObject(hdc, previous);
            let _ = DeleteObject(HGDIOBJ(hbitmap.0));
            let _ = DeleteDC(hdc);

            encode_png(width as u32, height as u32, &rgb)
        })();

        let _ = DeleteEnhMetaFile(hemf);
        result
    }
}

#[cfg(not(windows))]
pub fn emf_to_png(_bytes: &[u8]) -> Option<Vec<u8>> {
    None
}

/// Derives a pixel size from the metafile header, preferring the device-unit
/// bounds and falling back to the physical frame (which is in 0.01 mm units).
#[cfg(windows)]
fn emf_pixel_size(header: &windows::Win32::Graphics::Gdi::ENHMETAHEADER) -> (i32, i32) {
    let bounds_w = header.rclBounds.right - header.rclBounds.left + 1;
    let bounds_h = header.rclBounds.bottom - header.rclBounds.top + 1;
    if bounds_w > 1 && bounds_h > 1 {
        return (bounds_w, bounds_h);
    }

    // rclFrame is in 0.01 mm; 1 inch = 2540 such units = 96 px.
    let frame_w = (header.rclFrame.right - header.rclFrame.left) * 96 / 2540;
    let frame_h = (header.rclFrame.bottom - header.rclFrame.top) * 96 / 2540;
    (frame_w.max(1), frame_h.max(1))
}

#[cfg(windows)]
fn encode_png(width: u32, height: u32, rgb: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgb).ok()?;
    }
    Some(out)
}
