#!/usr/bin/env swift
import AppKit
import CoreText
import Foundation

func argValue (_ flag: String) -> String? {
  guard let idx = CommandLine.arguments.firstIndex(of: flag) else { return nil }
  let next = idx + 1
  guard next < CommandLine.arguments.count else { return nil }
  return CommandLine.arguments[next]
}

func parseHexColor (_ hex: String) -> NSColor {
  var h = hex.trimmingCharacters(in: .whitespacesAndNewlines)
  if h.hasPrefix("#") { h.removeFirst() }
  var value: UInt64 = 0
  Scanner(string: h).scanHexInt64(&value)
  let r = CGFloat((value >> 16) & 0xff) / 255.0
  let g = CGFloat((value >> 8) & 0xff) / 255.0
  let b = CGFloat(value & 0xff) / 255.0
  return NSColor(srgbRed: r, green: g, blue: b, alpha: 1)
}

func svgEscape (_ s: String) -> String {
  return s
    .replacingOccurrences(of: "&", with: "&amp;")
    .replacingOccurrences(of: "<", with: "&lt;")
    .replacingOccurrences(of: ">", with: "&gt;")
    .replacingOccurrences(of: "\"", with: "&quot;")
}

func pathToSvgD (_ path: CGPath) -> String {
  var d = ""
  path.applyWithBlock { element in
    let pts = element.pointee.points
    switch element.pointee.type {
    case .moveToPoint:
      d += String(format: "M%.3f %.3f", pts[0].x, pts[0].y)
    case .addLineToPoint:
      d += String(format: "L%.3f %.3f", pts[0].x, pts[0].y)
    case .addQuadCurveToPoint:
      d += String(format: "Q%.3f %.3f %.3f %.3f", pts[0].x, pts[0].y, pts[1].x, pts[1].y)
    case .addCurveToPoint:
      d += String(format: "C%.3f %.3f %.3f %.3f %.3f %.3f", pts[0].x, pts[0].y, pts[1].x, pts[1].y, pts[2].x, pts[2].y)
    case .closeSubpath:
      d += "Z"
    @unknown default:
      break
    }
  }
  return d
}

let fontPath = argValue("--font") ?? ""
let purpleHex = argValue("--purple") ?? "#4C1D95"
let whiteHex = argValue("--white") ?? "#FFFFFF"
let pngPath = argValue("--png")
let svgPath = argValue("--svg")
let size = Int(argValue("--size") ?? "1024") ?? 1024
let letter = argValue("--letter") ?? "f"
let transparent = CommandLine.arguments.contains("--transparent")

guard !fontPath.isEmpty, FileManager.default.fileExists(atPath: fontPath) else {
  fputs("render-fabric-icon.swift: --font PATH is required\n", stderr)
  exit(1)
}

let fontURL = URL(fileURLWithPath: fontPath) as CFURL
var registerErr: Unmanaged<CFError>?
if !CTFontManagerRegisterFontsForURL(fontURL, .process, &registerErr) {
  // Already registered is fine.
}

guard let descriptors = CTFontManagerCreateFontDescriptorsFromURL(fontURL) as? [CTFontDescriptor],
      let desc = descriptors.first else {
  fputs("render-fabric-icon.swift: could not read font descriptors\n", stderr)
  exit(1)
}

let ctFont = CTFontCreateWithFontDescriptor(desc, 1000, nil)
var unichars = Array(letter.utf16)
var glyphs = [CGGlyph](repeating: 0, count: unichars.count)
let ok = CTFontGetGlyphsForCharacters(ctFont, &unichars, &glyphs, unichars.count)
guard ok, let glyph = glyphs.first, glyph != 0,
      let rawPath = CTFontCreatePathForGlyph(ctFont, glyph, nil) else {
  fputs("render-fabric-icon.swift: no glyph path for letter\n", stderr)
  exit(1)
}

let rawBox = rawPath.boundingBoxOfPath
guard rawBox.width > 0, rawBox.height > 0 else {
  fputs("render-fabric-icon.swift: empty glyph bounds\n", stderr)
  exit(1)
}

let canvas = CGFloat(size)
let targetHeight = canvas * 0.68
let scale = targetHeight / rawBox.height
// Shift slightly down so the f-bowl, not the tall ascender, sits on the optical center.
let opticalY = canvas * -0.035
let tx = (canvas - rawBox.width * scale) / 2.0 - rawBox.minX * scale
let ty = (canvas - rawBox.height * scale) / 2.0 - rawBox.minY * scale + opticalY

var drawTransform = CGAffineTransform(translationX: tx, y: ty)
drawTransform = drawTransform.scaledBy(x: scale, y: scale)
guard let drawPath = rawPath.copy(using: &drawTransform) else {
  fputs("render-fabric-icon.swift: transform failed\n", stderr)
  exit(1)
}

let purple = parseHexColor(purpleHex)
let ink = parseHexColor(whiteHex)

if let pngPath {
  let colorSpace = CGColorSpaceCreateDeviceRGB()
  guard let ctx = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else {
    fputs("render-fabric-icon.swift: CGContext failed\n", stderr)
    exit(1)
  }
  if !transparent {
    ctx.setFillColor(purple.cgColor)
    ctx.fill(CGRect(x: 0, y: 0, width: canvas, height: canvas))
  }
  ctx.setFillColor(ink.cgColor)
  ctx.addPath(drawPath)
  ctx.fillPath()
  guard let image = ctx.makeImage() else {
    fputs("render-fabric-icon.swift: makeImage failed\n", stderr)
    exit(1)
  }
  let rep = NSBitmapImageRep(cgImage: image)
  guard let png = rep.representation(using: .png, properties: [:]) else {
    fputs("render-fabric-icon.swift: png encode failed\n", stderr)
    exit(1)
  }
  do {
    try png.write(to: URL(fileURLWithPath: pngPath))
  } catch {
    fputs("render-fabric-icon.swift: write png: \(error)\n", stderr)
    exit(1)
  }
}

if let svgPath {
  // SVG y-down: flip the already-positioned path around the canvas midline.
  var svgTransform = CGAffineTransform(translationX: 0, y: canvas)
  svgTransform = svgTransform.scaledBy(x: 1, y: -1)
  guard let svgPathRef = drawPath.copy(using: &svgTransform) else {
    fputs("render-fabric-icon.swift: svg transform failed\n", stderr)
    exit(1)
  }
  let d = pathToSvgD(svgPathRef)
  let svg = """
  <?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \(size) \(size)" role="img" aria-label="Fabric">
    <title>Fabric</title>
    \(transparent ? "" : "<rect width=\"\(size)\" height=\"\(size)\" fill=\"\(svgEscape(purpleHex))\"/>\n    ")<path fill="\(svgEscape(whiteHex))" d="\(d)"/>
  </svg>

  """
  do {
    try svg.write(to: URL(fileURLWithPath: svgPath), atomically: true, encoding: .utf8)
  } catch {
    fputs("render-fabric-icon.swift: write svg: \(error)\n", stderr)
    exit(1)
  }
}
