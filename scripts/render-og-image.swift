// Renders scripts/og-image.svg to public/og-image.png (1200×630) for link previews. macOS only (AppKit draws the SVG):
//   swift scripts/render-og-image.swift
import AppKit

let svg = URL(fileURLWithPath: "scripts/og-image.svg"), out = URL(fileURLWithPath: "public/og-image.png")
guard let image = NSImage(contentsOf: svg) else { fatalError("can't read \(svg.path)") }
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 1200, pixelsHigh: 630, bitsPerSample: 8,
                           samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                           bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
image.draw(in: NSRect(x: 0, y: 0, width: 1200, height: 630))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: out)
print("wrote \(out.path)")
