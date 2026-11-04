// 按 desktop/assets/dmg-background.json 画 dmg 的背景图（设计第 8.3 节第 2 条）。由 dmg-background.ts 调用：
//   swift dmg-background.swift <spec.json> <缩放 1 或 2> <输出 png> <Plus Jakarta Sans 的 ttf>
// 坐标以 1x 计、原点在左上角；@2x 的图像素翻倍，DPI 写成 144，electron-builder 用 tiffutil 把两张合成一张 tiff。
import AppKit
import CoreText

struct Spec: Decodable {
  struct Arrow: Decodable { let fromX, toX, y, lineWidth, head: Double; let color: String }
  struct Divider: Decodable { let y, inset: Double; let color: String }
  struct Line: Decodable { let text, font, weight, color: String; let size, y: Double }
  let width, height: Double
  let background: String
  let arrow: Arrow
  let divider: Divider
  let lines: [Line]
}

func color(_ hex: String) -> NSColor {
  let value = UInt32(hex.dropFirst(), radix: 16)!
  return NSColor(srgbRed: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255, blue: CGFloat(value & 0xFF) / 255, alpha: 1)
}

let args = CommandLine.arguments
guard args.count == 5, let scale = Int(args[2]), scale == 1 || scale == 2 else {
  FileHandle.standardError.write("usage: dmg-background.swift <spec.json> <1|2> <out.png> <jakarta.ttf>\n".data(using: .utf8)!)
  exit(2)
}
let spec = try JSONDecoder().decode(Spec.self, from: Data(contentsOf: URL(fileURLWithPath: args[1])))
let descriptors = CTFontManagerCreateFontDescriptorsFromURL(URL(fileURLWithPath: args[4]) as CFURL) as? [CTFontDescriptor] ?? []
guard let jakarta = descriptors.first else { fatalError("cannot load \(args[4])") }

func font(_ line: Spec.Line) -> NSFont {
  if line.font == "Plus Jakarta Sans" { return CTFontCreateWithFontDescriptor(jakarta, CGFloat(line.size), nil) as NSFont }
  return NSFont(name: line.weight == "medium" ? "PingFangSC-Medium" : "PingFangSC-Regular", size: CGFloat(line.size))!
}

let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: Int(spec.width) * scale, pixelsHigh: Int(spec.height) * scale,
  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
// 按点数设尺寸：绘图坐标就是 1x 的点，@2x 的 PNG 带 144 DPI。
rep.size = NSSize(width: spec.width, height: spec.height)
let context = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = context
// AppKit 的原点在左下角，spec 的原点在左上角。
func flip(_ y: Double) -> CGFloat { CGFloat(spec.height - y) }

color(spec.background).setFill()
NSRect(x: 0, y: 0, width: spec.width, height: spec.height).fill()

let arrow = NSBezierPath()
arrow.lineWidth = CGFloat(spec.arrow.lineWidth)
arrow.lineCapStyle = .round
arrow.lineJoinStyle = .round
arrow.move(to: NSPoint(x: spec.arrow.fromX, y: flip(spec.arrow.y)))
arrow.line(to: NSPoint(x: spec.arrow.toX, y: flip(spec.arrow.y)))
arrow.move(to: NSPoint(x: spec.arrow.toX - spec.arrow.head, y: flip(spec.arrow.y - spec.arrow.head)))
arrow.line(to: NSPoint(x: spec.arrow.toX, y: flip(spec.arrow.y)))
arrow.line(to: NSPoint(x: spec.arrow.toX - spec.arrow.head, y: flip(spec.arrow.y + spec.arrow.head)))
color(spec.arrow.color).setStroke()
arrow.stroke()

color(spec.divider.color).setFill()
NSRect(x: spec.divider.inset, y: Double(flip(spec.divider.y)), width: spec.width - 2 * spec.divider.inset, height: 1).fill()

for line in spec.lines {
  let text = NSAttributedString(string: line.text, attributes: [.font: font(line), .foregroundColor: color(line.color)])
  let size = text.size()
  // y 是这一行的竖直中心。
  text.draw(at: NSPoint(x: (spec.width - Double(size.width)) / 2, y: Double(flip(line.y)) - Double(size.height) / 2))
}

NSGraphicsContext.current = nil
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[3]))
