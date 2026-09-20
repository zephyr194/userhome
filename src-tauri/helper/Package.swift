// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "UserHomeHelper",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "UserHomeHelper", targets: ["UserHomeHelper"]),
    ],
    targets: [
        .executableTarget(
            name: "UserHomeHelper",
            linkerSettings: [
                .linkedFramework("Security"),
                .linkedFramework("ServiceManagement"),
            ]
        ),
    ]
)
