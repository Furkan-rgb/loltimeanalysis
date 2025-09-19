export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="mt-12 bg-card border-t border-border">
      <div className="container mx-auto py-6 px-4 text-center text-muted-foreground">
        <p className="text-sm text-muted-foreground">
          &copy; {currentYear}{" "}
          <a
            href="https://github.com/Furkan-rgb"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground hover:text-primary transition-colors"
          >
            Furkan-rgb
          </a>
        </p>
        <p className="text-xs mt-2 max-w-2xl mx-auto text-muted-foreground">
          This project is an independent creation and is not affiliated with,
          sponsored by, or endorsed by Riot Games, Inc. or any of its
          affiliates. League of Legends is a trademark or registered trademark
          of Riot Games, Inc.
        </p>
      </div>
    </footer>
  );
}
