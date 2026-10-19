import AppKit
import EventKit
import Foundation

// Read-only bridge. No EventKit save, remove, or calendar mutation calls.
let arguments = CommandLine.arguments
let mode = arguments.dropFirst().first ?? "status"
let outputIndex = arguments.firstIndex(of: "--output")
let outputPath = outputIndex.flatMap { $0 + 1 < arguments.count ? arguments[$0 + 1] : nil }
let store = EKEventStore()
let iso = ISO8601DateFormatter()
iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

func authorizationName() -> String {
    switch EKEventStore.authorizationStatus(for: .event) {
    case .fullAccess: return "active"
    case .notDetermined: return "permission_required"
    case .denied, .restricted, .writeOnly: return "denied"
    default: return "permission_required"
    }
}
func finish(_ value: [String: Any]) -> Never {
    let data = (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data("{}".utf8)
    if let outputPath {
        let url = URL(fileURLWithPath: outputPath)
        do {
            try data.write(to: url, options: .atomic)
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: outputPath)
        } catch {
            fputs("Calendar result could not be saved.\n", stderr)
            exit(1)
        }
    } else {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
    exit(0)
}
func readEvents() -> [String: Any] {
    let checkedAt = iso.string(from: Date())
    let status = authorizationName()
    guard status == "active" else { return ["status": status, "checkedAt": checkedAt, "events": []] }
    store.refreshSourcesIfNecessary()
    // iCloud only. Never read Google, Exchange, subscribed, or local calendars here.
    let calendars = store.calendars(for: .event).filter { calendar in
        let title = calendar.source.title.lowercased()
        return calendar.source.sourceType == .calDAV && (title == "icloud" || title == "아이클라우드")
    }
    guard !calendars.isEmpty else {
        return ["status": "no_icloud", "checkedAt": checkedAt, "events": [], "calendarCount": 0]
    }
    func argument(_ flag: String) -> String? {
        guard let i = arguments.firstIndex(of: flag), i + 1 < arguments.count else { return nil }
        return arguments[i + 1]
    }
    let requestedStart = argument("--start")
    let requestedEnd = argument("--end")
    let start = requestedStart.flatMap { iso.date(from: $0) } ?? Date()
    let end = requestedEnd.flatMap { iso.date(from: $0) } ?? Calendar.current.date(byAdding: .day, value: 7, to: start)!
    if requestedStart != nil || requestedEnd != nil {
        guard requestedStart.flatMap({ iso.date(from: $0) }) != nil,
              requestedEnd.flatMap({ iso.date(from: $0) }) != nil,
              end > start, end.timeIntervalSince(start) <= 15 * 86400 else {
            return ["status": "error", "checkedAt": checkedAt, "events": []]
        }
    }
    let predicate = store.predicateForEvents(withStart: start, end: end, calendars: calendars)
    let all = store.events(matching: predicate).filter { $0.status != .canceled && $0.endDate > start }.sorted { $0.startDate < $1.startDate }
    let events: [[String: Any]] = all.prefix(30).map { event in
        return [
            "id": event.eventIdentifier ?? event.calendarItemIdentifier,
            "title": String((event.title ?? "(Untitled event)").prefix(300)),
            "start": iso.string(from: event.startDate),
            "end": iso.string(from: event.endDate),
            "allDay": event.isAllDay,
            "timezone": event.timeZone?.identifier ?? TimeZone.current.identifier,
            "location": String((event.location ?? "").prefix(300)),
            "notes": String((event.notes ?? "").prefix(1000)),
            "calendarTitle": event.calendar.title
        ]
    }
    return ["status": "active", "checkedAt": checkedAt, "calendarCount": calendars.count,
            "events": events, "hasMore": all.count > 30, "windowStart": iso.string(from: start), "windowEnd": iso.string(from: end)]
}
if mode == "status" {
    finish(["status": authorizationName(), "checkedAt": iso.string(from: Date()), "supportsDateRange": true])
}
if mode == "read" { finish(readEvents()) }
guard mode == "authorize" else { finish(["status": "error", "error": "Unsupported command"]) }
if authorizationName() == "active" { finish(readEvents()) }
if authorizationName() == "denied" { finish(["status": "denied", "checkedAt": iso.string(from: Date())]) }
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.activate(ignoringOtherApps: true)
store.requestFullAccessToEvents { granted, error in
    DispatchQueue.main.async {
        if granted { finish(readEvents()) }
        finish(["status": "denied", "checkedAt": iso.string(from: Date())])
    }
}
app.run()
