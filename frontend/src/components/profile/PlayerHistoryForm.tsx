import { type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectLabel,
  SelectGroup,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { type useParams } from "react-router-dom";

// Define a type for our form data
type FormData = {
  region: string;
  username: string;
  tag: string;
};

// Define the component's props
type PlayerHistoryFormProps = {
  onSearch: (data: FormData) => void;
  onUpdate: () => void;
  isLoading: boolean;
  isDataLoaded: boolean;
  progress: number;
  cooldown: number;
  formData: FormData;
  onFormChange: (field: keyof FormData, value: string) => void;
  urlParams: ReturnType<typeof useParams>;
};

export function PlayerHistoryForm({
  onSearch,
  onUpdate,
  isLoading,
  isDataLoaded,
  progress,
  cooldown,
  formData,
  onFormChange,
  urlParams,
}: PlayerHistoryFormProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!formData.region || !formData.username || !formData.tag) {
      toast.error("Validation Error", {
        description: "Please fill out all fields before submitting.",
      });
      return;
    }

    // Check if the form's current data differs from the data in the URL
    const isNewSearch =
      formData.region !== urlParams.region ||
      formData.username !== urlParams.username ||
      formData.tag !== urlParams.tag;

    if (isNewSearch) {
      onSearch(formData);
    } else {
      onUpdate();
    }
  };

  // Helper to determine the correct button text based on the app's state
  const getButtonText = () => {
    // 1. Cooldown and loading states have top priority.
    if (cooldown > 0) return `Cooldown (${cooldown}s)`;
    if (isLoading) return "Fetching...";

    // 2. Check if the form's current data differs from the data in the URL.
    const isNewSearch =
      formData.region !== urlParams.region ||
      formData.username !== urlParams.username ||
      formData.tag !== urlParams.tag;

    // 3. The button text should directly reflect the action that will be taken.
    if (isNewSearch) {
      return "Fetch History"; // If it's a new search, the action is to fetch.
    } else {
      return "Update"; // Otherwise, the action is to update the current player.
    }
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="flex w-full items-end gap-2">
        <div className="flex-grow">
          <Label htmlFor="username" className="sr-only">
            Riot ID
          </Label>
          <div className="flex rounded-md shadow-sm">
            <Select
              value={formData.region}
              onValueChange={(value) => onFormChange("region", value)}
              disabled={isLoading}
            >
              <SelectTrigger
                id="region"
                className="w-28 rounded-r-none focus:ring-0"
                aria-label="Select region"
              >
                <SelectValue placeholder="Region" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Region</SelectLabel>
                  <SelectItem value="na">NA</SelectItem>
                  <SelectItem value="euw">EUW</SelectItem>
                  <SelectItem value="eune">EUNE</SelectItem>
                  <SelectItem value="kr">KR</SelectItem>
                  <SelectItem value="br">BR</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="relative flex-grow">
              <Input
                id="username"
                placeholder="Riot ID"
                value={formData.username}
                onChange={(e) => onFormChange("username", e.target.value)}
                className="rounded-l-none border-l-0 pl-3 pr-16 focus:ring-0"
                disabled={isLoading}
              />
              <div className="absolute inset-y-0 right-0 flex items-center">
                <span className="text-muted-foreground p-1">#</span>
                <Input
                  id="tag"
                  placeholder="Tag"
                  className="w-16 border-0 bg-transparent p-0 text-center focus:ring-0"
                  value={formData.tag}
                  onChange={(e) => onFormChange("tag", e.target.value)}
                  disabled={isLoading}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="flex-shrink-0">
          <Button type="submit" disabled={isLoading || cooldown > 0}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {getButtonText()}
          </Button>
        </div>
      </form>
      {isLoading && (
        <div className="mt-2">
          <Progress value={progress} />
        </div>
      )}
    </div>
  );
}

export default PlayerHistoryForm;
