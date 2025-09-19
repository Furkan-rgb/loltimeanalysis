export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-gray-50 border-t border-gray-200 mt-12">
      <div className="container mx-auto py-6 px-4 text-center text-gray-500">
        <p className="text-sm">
          &copy; {currentYear}{" "}
          <a
            href="https://github.com/Furkan-rgb" // <-- TODO: Add link here
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-gray-700 hover:text-blue-600 transition-colors"
          >
            Furkan-rgb
          </a>
        </p>
        <p className="text-xs mt-2 max-w-2xl mx-auto">
          This project is an independent creation and is not affiliated with,
          sponsored by, or endorsed by Riot Games, Inc. or any of its
          affiliates. League of Legends is a trademark or registered trademark
          of Riot Games, Inc.
        </p>
      </div>
    </footer>
  );
}
