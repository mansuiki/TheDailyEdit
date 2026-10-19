import Foundation
import AppKit
import MapKit

let input = try! JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [String: Any]
let origin = input["origin"] as! String
let destination = input["destination"] as! String
let output = input["imagePath"] as! String
let formatter = ISO8601DateFormatter()
let mode = input["mode"] as? String ?? "driving"
var retained: [AnyObject] = []
func finish(_ object: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: object)) ?? Data("{}".utf8)
    FileHandle.standardOutput.write(data)
    exit(0)
}
func findPlace(_ query: String, _ completion: @escaping (MKMapItem) -> Void) {
    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = query
    let search = MKLocalSearch(request: request)
    retained.append(search)
    search.start { result, error in
        guard let place = result?.mapItems.first else { finish(["error":"A location could not be found. Add a street address and city."]) }
        completion(place)
    }
}
findPlace(origin) { start in
    findPlace(destination) { end in
        let request = MKDirections.Request()
        request.source = start
        request.destination = end
        request.transportType = mode == "walking" ? .walking : .automobile
        request.requestsAlternateRoutes = false
        if let time = input["arrivalTime"] as? String, let date = formatter.date(from: time), date > Date() { request.arrivalDate = date }
        let directions = MKDirections(request: request)
        retained.append(directions)
        directions.calculate { response, error in
            guard let route = response?.routes.first else { finish(["error":"Apple Maps could not calculate this route. Try a more precise address or another travel mode."]) }
            var result: [String: Any] = ["provider":"Apple Maps", "durationSeconds":route.expectedTravelTime,"distanceMeters":route.distance,"originName":start.name ?? origin,"destinationName":end.name ?? destination,"originAddress":start.placemark.title ?? origin,"destinationAddress":end.placemark.title ?? destination,"mode":mode,"checkedAt":formatter.string(from:Date())]
            let options = MKMapSnapshotter.Options()
            options.size = NSSize(width:1000,height:580)
            let bounds = route.polyline.boundingMapRect
            options.mapRect = bounds.insetBy(dx:-max(bounds.size.width * 0.2,1500),dy:-max(bounds.size.height * 0.25,1500))
            options.showsBuildings = false
            let snapshotter = MKMapSnapshotter(options:options)
            retained.append(snapshotter)
            snapshotter.start { snapshot, error in
                if let snapshot {
                    let image = snapshot.image
                    image.lockFocus()
                    let line = NSBezierPath()
                    line.lineWidth = 6
                    line.lineJoinStyle = .round
                    let points = route.polyline.points()
                    for i in 0..<route.polyline.pointCount {
                        let p = snapshot.point(for: points[i].coordinate)
                        if i == 0 { line.move(to:p) } else { line.line(to:p) }
                    }
                    NSColor.systemBlue.setStroke(); line.stroke()
                    for (item, color) in [(start,NSColor.darkGray),(end,NSColor.systemRed)] {
                        let p = snapshot.point(for:item.placemark.coordinate)
                        let dot = NSBezierPath(ovalIn:NSRect(x:p.x-7,y:p.y-7,width:14,height:14))
                        color.setFill();dot.fill();NSColor.white.setStroke();dot.lineWidth=2;dot.stroke()
                    }
                    image.unlockFocus()
                    if let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data:tiff), let png = bitmap.representation(using:.png,properties:[:]) {
                        try? png.write(to:URL(fileURLWithPath:output),options:.atomic)
                        try? FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:output)
                        result["hasMap"] = true
                    }
                }
                finish(result)
            }
        }
    }
}
DispatchQueue.main.asyncAfter(deadline:.now()+40) { finish(["error":"Apple Maps timed out. Try again shortly."]) }
RunLoop.main.run()
