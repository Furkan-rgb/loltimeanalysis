# worker.py
import arq
import sys
import asyncio
from watchfiles import run_process

import config

# Import all the functions the worker needs to be able to run
from tasks import dispatch_fetch_job, fetch_match_details_task, aggregate_results_task


class WorkerSettings:
    """
    Defines the settings for our ARQ worker.
    This is where we list all the tasks it's allowed to execute.
    """

    functions = [dispatch_fetch_job, fetch_match_details_task, aggregate_results_task]
    redis_settings = arq.connections.RedisSettings(
        host=config.REDIS_HOST, port=config.REDIS_PORT
    )

    # CORRECTED: Removed the 'self' argument from the function definition.
    async def on_startup(ctx):
        """
        Runs when the worker starts. We use this to pass the --verbose
        flag from the command line into the worker's context.
        """
        ctx["verbose"] = "--verbose" in sys.argv
        if ctx["verbose"]:
            print("Verbose logging enabled.")


if __name__ == "__main__":
    """
    This block allows you to run the worker directly from the command line
    with `python worker.py`. It supports a `--watch` flag for auto-reloading
    during development.
    """
    import asyncio
    from arq.worker import run_worker
    from watchfiles import run_process

    watch = "--watch" in sys.argv

    if watch:
        # If --watch is used, run the worker using the standard 'arq' command-line
        # interface, which watchfiles will monitor and restart upon code changes.
        print("Starting ARQ worker with --watch enabled...")
        run_process(
            ".",
            target=f"arq worker.WorkerSettings",
            callback=lambda _: print("Changes detected, restarting worker..."),
        )
    else:
        # If not watching, we run the worker programmatically using run_worker.
        # This is the correct way to start it from within the script.
        print("Starting ARQ worker...")
        asyncio.run(run_worker(WorkerSettings))
